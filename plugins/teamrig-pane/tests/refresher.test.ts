// When each view reads again (hooks/refresher.ts): at once at the start; on a frame marking one of its documents with
// a revision it does not hold, the first at once and later ones a gap after that read began; when shown, for a view
// left stale while hidden; on the poll tick while no stream said hello, for a document the stream does not serve and
// after a failed read. A stream that ends is followed again after a doubling wait, and nothing outlives a stop (T4760).
import { describe, expect, test } from 'claude-code/testing'
import type { Every } from '../hooks/bounded-run'
import type { ChangeFeed, FeedEnd, FeedListener } from '../hooks/change-feed'
import { GAP_MS, POLL_MS, RESTART_MAX_MS, RESTART_MIN_MS, Refresher, type RefreshAsk, type Subject } from '../hooks/refresher'

/** Lets every promise already settled run its continuations. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

type Entry = { readonly ms: number; readonly fn: () => void; due: number; isCancelled: boolean }

/** A clock the test moves: `advance` fires each due timer in time order, settling what it started before the next. */
function fakeClock(): { every: Every; advance: (ms: number) => Promise<void>; running: () => number[] } {
  let now = 0
  const entries: Entry[] = []
  return {
    every: (ms, fn) => {
      const entry: Entry = { ms, fn, due: now + ms, isCancelled: false }
      entries.push(entry)
      return {
        cancel: () => {
          entry.isCancelled = true
        },
      }
    },
    advance: async ms => {
      const end = now + ms
      for (;;) {
        const [next] = entries.filter(entry => !entry.isCancelled && entry.due <= end).sort((a, b) => a.due - b.due)
        if (next === undefined) break
        now = next.due
        next.due += next.ms
        next.fn()
        await settle()
      }
      now = end
    },
    running: () => entries.filter(entry => !entry.isCancelled).map(entry => entry.ms),
  }
}

type Followed = { readonly documents: readonly string[]; readonly listener: FeedListener; isStopped: boolean }

/** A feed the test speaks for: each follow is recorded with its listener; `endAtStart` ends every new one inside follow. */
function scriptedFeed(): { feed: ChangeFeed; follows: Followed[]; stream: () => FeedListener; endAtStart: (end: FeedEnd | null) => void } {
  const follows: Followed[] = []
  let atStart: FeedEnd | null = null
  return {
    feed: {
      follow: (documents, listener) => {
        const followed: Followed = { documents, listener, isStopped: false }
        follows.push(followed)
        if (atStart !== null) listener.onEnd(atStart)
        return {
          stop: () => {
            followed.isStopped = true
          },
        }
      },
    },
    follows,
    stream: () => {
      const last = follows[follows.length - 1]
      if (last === undefined) throw new Error('nothing is followed')
      return last.listener
    },
    endAtStart: end => {
      atStart = end
    },
  }
}

type View = {
  readonly subject: Subject
  reads: number
  /** What each read was told, in order. */
  readonly asks: RefreshAsk[]
  isShown: boolean
  /** What its next reads answer; an Error rejects. */
  answer: boolean | Error
  readonly held: Map<string, string>
  /** While set, a read waits until the test calls `finish`. */
  isSlow: boolean
  finish: () => void
}

function viewOf(...documents: string[]): View {
  return viewPolling(false, ...documents)
}

function viewPolling(polls: boolean, ...documents: string[]): View {
  const view: View = {
    subject: {
      documents,
      polls,
      isShown: () => Promise.resolve(view.isShown),
      held: document => view.held.get(document) ?? null,
      refresh: async ask => {
        view.reads += 1
        view.asks.push(ask)
        if (view.isSlow) await new Promise<void>(resolve => (view.finish = resolve))
        if (view.answer instanceof Error) throw view.answer
        return view.answer
      },
    },
    reads: 0,
    asks: [],
    isShown: true,
    answer: true,
    held: new Map(),
    isSlow: false,
    finish: () => undefined,
  }
  return view
}

function hello(...marks: [string, string | null][]): { event: 'hello'; documents: { document: string; revision: string | null }[] } {
  return { event: 'hello', documents: marks.map(([document, revision]) => ({ document, revision })) }
}

function changed(...marks: [string, string | null][]): { event: 'changed'; documents: { document: string; revision: string | null }[] } {
  return { event: 'changed', documents: marks.map(([document, revision]) => ({ document, revision })) }
}

/** A started refresher over `views`, its first reads done. */
async function started(...views: View[]): Promise<{ refresher: Refresher; clock: ReturnType<typeof fakeClock>; feed: ReturnType<typeof scriptedFeed> }> {
  const clock = fakeClock()
  const feed = scriptedFeed()
  const refresher = new Refresher({ feed: feed.feed, every: clock.every }, views.map(view => view.subject))
  refresher.start()
  await settle()
  return { refresher, clock, feed }
}

/** A refresher whose stream said hello to `tasks` at r7 and `inbox` at r2, both held, the first reads' gap over. */
async function live(): Promise<{ tasks: View; inbox: View } & Awaited<ReturnType<typeof started>>> {
  const tasks = viewOf('tasks')
  const inbox = viewOf('inbox')
  tasks.held.set('tasks', 'r7')
  inbox.held.set('inbox', 'r2')
  const run = await started(tasks, inbox)
  run.feed.stream().onFrame(hello(['tasks', 'r7'], ['inbox', 'r2']))
  await run.clock.advance(GAP_MS)
  return { tasks, inbox, ...run }
}

describe('Refresher', () => {
  test('at its start reads each drawn view at once and follows every document once', async () => {
    const tasks = viewOf('tasks', 'config')
    const team = viewOf('sessions', 'config')
    const { feed, refresher } = await started(tasks, team)
    expect([tasks.reads, team.reads]).toEqual([1, 1])
    expect(feed.follows.map(followed => followed.documents)).toEqual([['tasks', 'config', 'sessions']])
    expect(refresher.feedState()).toEqual({ isLive: false, problems: [] })
  })

  test('while no stream said hello, each view reads on the poll tick', async () => {
    const tasks = viewOf('tasks')
    const { clock } = await started(tasks)
    await clock.advance(POLL_MS - 1)
    expect(tasks.reads).toBe(1)
    await clock.advance(1)
    expect(tasks.reads).toBe(2)
    await clock.advance(2 * POLL_MS)
    expect(tasks.reads).toBe(4)
  })

  test('once a stream said hello with the revisions held, nothing reads until a frame says so', async () => {
    const { tasks, inbox, clock, refresher } = await live()
    await clock.advance(6 * POLL_MS)
    expect([tasks.reads, inbox.reads]).toEqual([1, 1])
    expect(refresher.feedState().isLive).toBe(true)
  })

  test('a hello marking a revision a view does not hold reads that view', async () => {
    const tasks = viewOf('tasks')
    const inbox = viewOf('inbox')
    tasks.held.set('tasks', 'r7')
    inbox.held.set('inbox', 'r2')
    const { feed, clock } = await started(tasks, inbox)
    await clock.advance(GAP_MS)
    feed.stream().onFrame(hello(['tasks', 'r7'], ['inbox', 'r3']))
    await settle()
    expect([tasks.reads, inbox.reads]).toEqual([1, 2])
  })

  test('each read is told the marks it was started for, held ones dropped, and whether the stream serves its documents (T5655)', async () => {
    const tasks = viewPolling(true, 'tasks', 'plan')
    tasks.held.set('tasks', 'r7')
    tasks.held.set('plan', 'p1')
    const { feed, clock } = await started(tasks)
    expect(tasks.asks).toEqual([{ marked: [], isFollowed: false }])
    feed.stream().onFrame(hello(['tasks', 'r7']))
    await clock.advance(GAP_MS)
    feed.stream().onFrame(changed(['tasks', 'r7'], ['plan', 'p2']))
    await settle()
    expect(tasks.asks.slice(1)).toEqual([{ marked: ['plan'], isFollowed: false }])
    feed.stream().onFrame(hello(['tasks', 'r7'], ['plan', 'p1']))
    await clock.advance(POLL_MS)
    expect(tasks.asks.slice(2)).toEqual([{ marked: [], isFollowed: true }])
  })

  test('a changed frame reads at once the view that draws the document, and no other', async () => {
    const { tasks, inbox, feed } = await live()
    feed.stream().onFrame(changed(['tasks', 'r8'], ['goals', 'g1']))
    await settle()
    expect([tasks.reads, inbox.reads]).toEqual([2, 1])
  })

  test('changes inside the gap wait for it, measured from the read that began it, and read once', async () => {
    const { tasks, feed, clock } = await live()
    feed.stream().onFrame(changed(['tasks', 'r8']))
    await settle()
    tasks.held.set('tasks', 'r8')
    await clock.advance(1_000)
    feed.stream().onFrame(changed(['tasks', 'r9']))
    feed.stream().onFrame(changed(['tasks', 'r10']))
    await clock.advance(GAP_MS - 1_001)
    expect(tasks.reads).toBe(2)
    await clock.advance(1)
    expect(tasks.reads).toBe(3)
  })

  test('a mark with the revision held reads nothing; one with no revision reads', async () => {
    const { tasks, feed } = await live()
    feed.stream().onFrame(changed(['tasks', 'r7']))
    await settle()
    expect(tasks.reads).toBe(1)
    feed.stream().onFrame(changed(['tasks', null]))
    await settle()
    expect(tasks.reads).toBe(2)
  })

  test('a mark that arrives during the read that brings its revision asks for no second read', async () => {
    const { tasks, feed, clock } = await live()
    tasks.isSlow = true
    feed.stream().onFrame(changed(['tasks', 'r8']))
    await settle()
    feed.stream().onFrame(changed(['tasks', 'r9']))
    tasks.held.set('tasks', 'r9')
    tasks.finish()
    await clock.advance(2 * GAP_MS)
    expect(tasks.reads).toBe(2)
  })

  test('a read longer than the gap is followed at its end by the read marked meanwhile', async () => {
    const { tasks, feed, clock } = await live()
    tasks.isSlow = true
    feed.stream().onFrame(changed(['tasks', 'r8']))
    await settle()
    feed.stream().onFrame(changed(['tasks', 'r9']))
    await clock.advance(GAP_MS + 1_000)
    expect(tasks.reads).toBe(2)
    tasks.isSlow = false
    tasks.held.set('tasks', 'r8')
    tasks.finish()
    await settle()
    expect(tasks.reads).toBe(3)
  })

  test('a hidden view is left stale, and reads when the view changes to it or the tick finds it shown', async () => {
    const { tasks, inbox, feed, clock, refresher } = await live()
    tasks.isShown = false
    inbox.isShown = false
    feed.stream().onFrame(changed(['tasks', 'r8'], ['inbox', 'r3']))
    await clock.advance(2 * POLL_MS)
    expect([tasks.reads, inbox.reads]).toEqual([1, 1])
    tasks.isShown = true
    refresher.viewChanged()
    await settle()
    expect([tasks.reads, inbox.reads]).toEqual([2, 1])
    inbox.isShown = true
    await clock.advance(POLL_MS)
    expect([tasks.reads, inbox.reads]).toEqual([2, 2])
  })

  test('a view hidden at the start reads when shown; one whose shown check rejects counts as hidden', async () => {
    const tasks = viewOf('tasks')
    tasks.isShown = false
    const broken = viewOf('inbox')
    const subject: Subject = { ...broken.subject, isShown: () => Promise.reject(new Error('no view')) }
    const clock = fakeClock()
    const feed = scriptedFeed()
    const refresher = new Refresher({ feed: feed.feed, every: clock.every }, [tasks.subject, subject])
    refresher.start()
    await settle()
    expect([tasks.reads, broken.reads]).toEqual([0, 0])
    tasks.isShown = true
    refresher.viewChanged()
    await settle()
    expect([tasks.reads, broken.reads]).toEqual([1, 0])
  })

  test('a view with a document the stream does not serve keeps reading on the tick', async () => {
    const tasks = viewOf('tasks')
    const stats = viewOf('tasks', 'stats')
    tasks.held.set('tasks', 'r7')
    stats.held.set('tasks', 'r7')
    const { feed, clock } = await started(tasks, stats)
    feed.stream().onFrame(hello(['tasks', 'r7']))
    await clock.advance(2 * POLL_MS)
    expect([tasks.reads, stats.reads]).toEqual([1, 3])
  })

  test('a view that polls keeps reading on the tick while the stream is live, and a frame still reads it at once', async () => {
    const tasks = viewPolling(true, 'tasks')
    tasks.held.set('tasks', 'r7')
    const { feed, clock, refresher } = await started(tasks)
    feed.stream().onFrame(hello(['tasks', 'r7']))
    await clock.advance(2 * POLL_MS)
    expect(refresher.feedState().isLive).toBe(true)
    expect(tasks.reads).toBe(3)
    feed.stream().onFrame(changed(['tasks', 'r8']))
    await clock.advance(GAP_MS)
    expect(tasks.reads).toBe(4)
  })

  test('refollow ends the stream and follows again at once, keeping the views read', async () => {
    const { tasks, inbox, feed, refresher } = await live()
    refresher.refollow()
    await settle()
    expect(feed.follows.length).toBe(2)
    expect(feed.follows[0]?.isStopped).toBe(true)
    expect(feed.follows[1]?.isStopped).toBe(false)
    expect(refresher.feedState().isLive).toBe(false)
    expect([tasks.reads, inbox.reads]).toEqual([1, 1])
    feed.follows[0]?.listener.onFrame(changed(['tasks', 'r8']))
    await settle()
    expect(tasks.reads).toBe(1)
    feed.stream().onFrame(hello(['tasks', 'r8'], ['inbox', 'r2']))
    await settle()
    expect([tasks.reads, inbox.reads]).toEqual([2, 1])
  })

  test('refollow drops a pending restart, so an ended stream is not followed twice', async () => {
    const { feed, clock, refresher } = await live()
    feed.stream().onEnd('ended')
    refresher.refollow()
    await clock.advance(RESTART_MAX_MS)
    expect(feed.follows.length).toBe(2)
  })

  test('a failed read, or one that rejects, is read again on the tick until it works', async () => {
    const { tasks, inbox, feed, clock } = await live()
    tasks.answer = false
    inbox.answer = new Error('no answer in 35 s')
    feed.stream().onFrame(changed(['tasks', 'r8'], ['inbox', 'r3']))
    await settle()
    expect([tasks.reads, inbox.reads]).toEqual([2, 2])
    await clock.advance(POLL_MS)
    expect([tasks.reads, inbox.reads]).toEqual([3, 3])
    tasks.answer = true
    inbox.answer = true
    await clock.advance(POLL_MS)
    expect([tasks.reads, inbox.reads]).toEqual([4, 4])
    await clock.advance(3 * POLL_MS)
    expect([tasks.reads, inbox.reads]).toEqual([4, 4])
  })

  test('a stream that ends hands the views back to the tick and is followed again after a wait that doubles', async () => {
    const { tasks, feed, clock, refresher } = await live()
    const waits: number[] = []
    for (let ended = 0; ended < 8; ended += 1) {
      const wait = Math.min(RESTART_MIN_MS * 2 ** ended, RESTART_MAX_MS)
      waits.push(wait)
      feed.stream().onFrame(hello(['tasks', 'r7'], ['inbox', 'r2']))
      feed.stream().onEnd('ended')
      expect(refresher.feedState().isLive).toBe(false)
      const follows = feed.follows.length
      await clock.advance(wait - 1)
      expect(feed.follows.length).toBe(follows)
      await clock.advance(1)
      expect(feed.follows.length).toBe(follows + 1)
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000])
    expect(tasks.reads).toBeGreaterThan(10)
  })

  test('the wait starts over once a stream stayed open as long as the longest wait', async () => {
    const { feed, clock } = await live()
    feed.stream().onEnd('ended')
    await clock.advance(RESTART_MIN_MS)
    feed.stream().onEnd('ended')
    await clock.advance(2 * RESTART_MIN_MS)
    expect(feed.follows.length).toBe(3)
    feed.stream().onFrame(hello(['tasks', 'r7'], ['inbox', 'r2']))
    await clock.advance(RESTART_MAX_MS)
    feed.stream().onEnd('ended')
    await clock.advance(RESTART_MIN_MS)
    expect(feed.follows.length).toBe(4)
  })

  test('a stream that cannot start is tried again after the same doubling wait; an unavailable one never', async () => {
    const tasks = viewOf('tasks')
    const clock = fakeClock()
    const feed = scriptedFeed()
    feed.endAtStart('ended')
    const refresher = new Refresher({ feed: feed.feed, every: clock.every }, [tasks.subject])
    refresher.start()
    await clock.advance(RESTART_MIN_MS + 2 * RESTART_MIN_MS)
    expect(feed.follows.length).toBe(3)
    feed.endAtStart('unavailable')
    await clock.advance(10 * RESTART_MAX_MS)
    expect(feed.follows.length).toBe(4)
    expect(tasks.reads).toBeGreaterThan(50)
    refresher.stop()
    expect(feed.follows.map(followed => followed.isStopped)).toEqual([false, false, false, false])
  })

  test('says why frames could not be read until a stream says hello', async () => {
    const tasks = viewOf('tasks')
    const { feed, refresher } = await started(tasks)
    feed.stream().onProblem('teamrig sent an event that is no JSON')
    feed.stream().onProblem('teamrig sent an event that is no JSON')
    expect(refresher.feedState()).toEqual({ isLive: false, problems: ['teamrig sent an event that is no JSON'] })
    feed.stream().onFrame(hello(['tasks', null]))
    expect(refresher.feedState()).toEqual({ isLive: true, problems: [] })
  })

  test('a stop ends the stream and every timer, and what arrives after it reads nothing', async () => {
    const { tasks, feed, clock, refresher } = await live()
    const stream = feed.stream()
    feed.stream().onFrame(changed(['tasks', 'r8']))
    await settle()
    refresher.stop()
    expect(feed.follows.map(followed => followed.isStopped)).toEqual([true])
    expect(clock.running()).toEqual([])
    stream.onFrame(changed(['tasks', 'r9']))
    stream.onProblem('late')
    stream.onEnd('ended')
    refresher.viewChanged()
    await clock.advance(10 * POLL_MS)
    expect(tasks.reads).toBe(2)
    expect(feed.follows.length).toBe(1)
    expect(refresher.feedState()).toEqual({ isLive: false, problems: [] })
    refresher.stop()
  })

  test('a start after a stop begins again: every view reads, and a frame of the earlier stream is dropped', async () => {
    const { tasks, feed, refresher } = await live()
    const earlier = feed.stream()
    tasks.isSlow = true
    earlier.onFrame(changed(['tasks', 'r8']))
    await settle()
    refresher.start()
    await settle()
    expect(tasks.reads).toBe(3)
    earlier.onFrame(changed(['tasks', 'r9']))
    tasks.isSlow = false
    tasks.finish()
    await settle()
    expect(tasks.reads).toBe(3)
    expect(feed.follows.map(followed => followed.isStopped)).toEqual([true, false])
  })
})
