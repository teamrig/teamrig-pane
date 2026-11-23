// The dock's event stream over `$.process.spawn` (hooks/spawn-feed.ts): it starts `teamrig events --json` for the
// documents followed, as the pane's asker; reads stdout's pieces as frames, cut anywhere; ends `ended` after a hello,
// `unavailable` when the CLI is missing, the child cannot start or it exits non-zero before any hello; and `stop`
// returns the stream, which is what kills the child, after which the listener hears nothing (T4760).
import { describe, expect, test } from 'claude-code/testing'
import type { FeedEnd, FeedFrame } from '../hooks/change-feed'
import type { ReadAsker } from '../hooks/read-port'
import { eventsWords, followable, spawnFeed, STDERR_KEPT_CHARS, type SpawnChunk, type SpawnEnd, type SpawnStream } from '../hooks/spawn-feed'
import type { TeamrigCli } from '../hooks/teamrig-cli'

async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
}

type Item = { readonly kind: 'chunk'; readonly chunk: SpawnChunk } | { readonly kind: 'end'; readonly end: SpawnEnd } | { readonly kind: 'fail'; readonly error: Error }

/** A child the test writes for: each item is what its stream's next pull answers; `returns` counts `return()` calls. */
class ScriptedChild {
  readonly argv: readonly string[]
  returns = 0
  private readonly items: Item[] = []
  private waiting: ((item: Item) => void) | null = null
  readonly stream: SpawnStream

  constructor(argv: readonly string[]) {
    this.argv = argv
    // A plain object over the generator, so no generator's own `return` is assigned: under the engine runner that
    // assignment threw and no child was ever recorded.
    const generator = this.body()
    this.stream = {
      next: () => generator.next(),
      return: (value: SpawnEnd) => {
        this.returns += 1
        // A real stream's return kills the child, which ends the pull it waits on: the script ends it the same way.
        this.end({ code: null, signal: null })
        return generator.return(value)
      },
    }
  }

  write(text: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    this.put({ kind: 'chunk', chunk: { stream, text } })
  }

  end(end: SpawnEnd): void {
    this.put({ kind: 'end', end })
  }

  fail(error: Error): void {
    this.put({ kind: 'fail', error })
  }

  private put(item: Item): void {
    const waiting = this.waiting
    this.waiting = null
    if (waiting === null) this.items.push(item)
    else waiting(item)
  }

  private take(): Promise<Item> {
    const item = this.items.shift()
    if (item !== undefined) return Promise.resolve(item)
    return new Promise(resolve => {
      this.waiting = resolve
    })
  }

  private async *body(): AsyncGenerator<SpawnChunk, SpawnEnd> {
    for (;;) {
      const item = await this.take()
      if (item.kind === 'chunk') yield item.chunk
      else if (item.kind === 'end') return item.end
      else throw item.error
    }
  }
}

const FOUND: TeamrigCli = { kind: 'found', main: 'cli/teamrig.js' }
const ASKER: ReadAsker = { session: 'api', conversation: 'c-1' }

/** A feed whose children are scripted, and what its listener heard, as lines. */
function rig(cli: TeamrigCli | Error = FOUND, asker: ReadAsker = ASKER) {
  const children: ScriptedChild[] = []
  const heard: string[] = []
  const feed = spawnFeed({
    spawn: request => {
      const child = new ScriptedChild(request.argv)
      children.push(child)
      return child.stream
    },
    cli: () => (cli instanceof Error ? Promise.reject(cli) : Promise.resolve(cli)),
    asker: () => asker,
  })
  const listener = {
    onFrame: (frame: FeedFrame) => heard.push(`${frame.event} ${frame.documents.map(mark => `${mark.document}@${mark.revision ?? '-'}`).join(',')}`),
    onProblem: (reason: string) => heard.push(`problem ${reason}`),
    onEnd: (end: FeedEnd) => heard.push(`end ${end}`),
  }
  return { children, heard, follow: (documents: readonly string[]) => feed.follow(documents, listener) }
}

const HELLO = '{"interface":"1.0","event":"hello","documents":[{"document":"tasks","revision":"r1"},{"document":"inbox","revision":"i1"}]}\n'
const CHANGED = '{"interface":"1.0","event":"changed","documents":[{"document":"tasks","revision":"r2"}]}\n'

describe('eventsWords', () => {
  test('follows the documents in one comma list, as JSON, asking as the read does', () => {
    expect(eventsWords(['tasks', 'inbox'], ASKER)).toEqual(['events', '--json', '--documents', 'tasks,inbox', '--session', 'api', '--conversation', 'c-1'])
    expect(eventsWords(['tasks'], { session: null, conversation: 'c 1;x' })).toEqual(['events', '--json', '--documents', 'tasks'])
  })
})

describe('followable', () => {
  test('leaves the inbox out when no session is named, as teamrig refuses a stream asking for it then', () => {
    expect(followable(['tasks', 'inbox'], ASKER)).toEqual(['tasks', 'inbox'])
    expect(followable(['tasks', 'inbox'], { session: null, conversation: 'c-1' })).toEqual(['tasks'])
  })
})

describe('spawnFeed', () => {
  test('with no session asked as, follows the documents but the inbox; with only the inbox, starts nothing', async () => {
    const some = rig(FOUND, { session: null, conversation: 'c-1' })
    some.follow(['tasks', 'inbox'])
    const none = rig(FOUND, { session: null, conversation: 'c-1' })
    none.follow(['inbox'])
    await settle()
    expect(some.children.map(child => child.argv)).toEqual([['node', 'cli/teamrig.js', 'events', '--json', '--documents', 'tasks', '--conversation', 'c-1']])
    expect([none.children.length, none.heard]).toEqual([0, ['end unavailable']])
  })

  test('starts the CLI following the documents, and reads frames from pieces cut anywhere', async () => {
    const { children, heard, follow } = rig()
    follow(['tasks', 'inbox'])
    await settle()
    expect(children.map(child => child.argv)).toEqual([['node', 'cli/teamrig.js', 'events', '--json', '--documents', 'tasks,inbox', '--session', 'api', '--conversation', 'c-1']])
    const child = children[0]
    if (child === undefined) throw new Error('no child started')
    child.write(HELLO.slice(0, 30))
    child.write(HELLO.slice(30) + CHANGED.slice(0, 10))
    child.write('a warning\n', 'stderr')
    child.write(CHANGED.slice(10))
    await settle()
    expect(heard).toEqual(['hello tasks@r1,inbox@i1', 'changed tasks@r2'])
  })

  test('a stdout line that is no frame is told as a problem, and the frames around it are still read', async () => {
    const { children, heard, follow } = rig()
    follow(['tasks'])
    await settle()
    children[0]?.write(HELLO + 'not a frame\n' + CHANGED)
    await settle()
    expect(heard).toHaveLength(3)
    expect(heard[0]).toBe('hello tasks@r1,inbox@i1')
    expect(heard[1]?.startsWith('problem ')).toBe(true)
    expect(heard[2]).toBe('changed tasks@r2')
  })

  test('a stream that said hello and then ended is ended, whatever its code', async () => {
    const { children, heard, follow } = rig()
    follow(['tasks'])
    await settle()
    children[0]?.write(HELLO)
    children[0]?.end({ code: 1, signal: null })
    await settle()
    expect(heard).toEqual(['hello tasks@r1,inbox@i1', 'end ended'])
  })

  test('an exit 0 with no hello is ended: a follower that saw its starter go', async () => {
    const { children, heard, follow } = rig()
    follow(['tasks'])
    await settle()
    children[0]?.end({ code: 0, signal: null })
    await settle()
    expect(heard).toEqual(['end ended'])
  })

  test('a non-zero exit before any hello is unavailable, told with what it wrote to stderr', async () => {
    const { children, heard, follow } = rig()
    follow(['tasks'])
    await settle()
    children[0]?.write('Error: unknown command "events"\n', 'stderr')
    children[0]?.end({ code: 2, signal: null })
    await settle()
    expect(heard).toEqual(['problem teamrig events: Error: unknown command "events"', 'end unavailable'])
  })

  test('with nothing on stderr the exit or the signal says why; stderr is kept to its bound', async () => {
    const coded = rig()
    coded.follow(['tasks'])
    await settle()
    coded.children[0]?.end({ code: 3, signal: null })
    const signalled = rig()
    signalled.follow(['tasks'])
    await settle()
    signalled.children[0]?.end({ code: null, signal: 'SIGTERM' })
    const loud = rig()
    loud.follow(['tasks'])
    await settle()
    loud.children[0]?.write('x'.repeat(STDERR_KEPT_CHARS * 2), 'stderr')
    loud.children[0]?.end({ code: 1, signal: null })
    await settle()
    expect(coded.heard).toEqual(['problem teamrig events exited 3', 'end unavailable'])
    expect(signalled.heard).toEqual(['problem teamrig events ended by SIGTERM', 'end unavailable'])
    expect(loud.heard[0]?.length).toBe('problem teamrig events: '.length + STDERR_KEPT_CHARS)
  })

  test('a child that cannot start is unavailable; one that breaks after a piece is ended', async () => {
    const unstarted = rig()
    unstarted.follow(['tasks'])
    await settle()
    unstarted.children[0]?.fail(new Error('ENOENT'))
    const broken = rig()
    broken.follow(['tasks'])
    await settle()
    broken.children[0]?.write(HELLO)
    broken.children[0]?.fail(new Error('pipe closed'))
    await settle()
    expect(unstarted.heard).toEqual(['problem teamrig events could not start: ENOENT', 'end unavailable'])
    expect(broken.heard).toEqual(['hello tasks@r1,inbox@i1', 'end ended'])
  })

  test('a spawn that throws at once is unavailable and told why, so the refresher polls (T5189)', async () => {
    const heard: string[] = []
    const feed = spawnFeed({
      spawn: () => {
        throw new Error('EINVAL')
      },
      cli: () => Promise.resolve(FOUND),
      asker: () => ASKER,
    })
    feed.follow(['tasks'], {
      onFrame: frame => heard.push(frame.event),
      onProblem: reason => heard.push(`problem ${reason}`),
      onEnd: end => heard.push(`end ${end}`),
    })
    await settle()
    expect(heard).toEqual(['problem teamrig events could not start: EINVAL', 'end unavailable'])
  })

  test('a missing CLI starts nothing and is unavailable; a failed look for it says why', async () => {
    const missing = rig({ kind: 'missing', problem: 'no teamrig' })
    missing.follow(['tasks'])
    const failed = rig(new Error('EACCES'))
    failed.follow(['tasks'])
    await settle()
    expect([missing.children.length, missing.heard]).toEqual([0, ['end unavailable']])
    expect([failed.children.length, failed.heard]).toEqual([0, ['problem cannot find the teamrig CLI: EACCES', 'end unavailable']])
  })

  test('stop returns the stream, which kills the child, once; the listener hears nothing after it', async () => {
    const { children, heard, follow } = rig()
    const handle = follow(['tasks'])
    await settle()
    children[0]?.write(HELLO)
    await settle()
    handle.stop()
    handle.stop()
    children[0]?.write(CHANGED)
    await settle()
    expect([children[0]?.returns, heard]).toEqual([1, ['hello tasks@r1,inbox@i1']])
  })

  test('a stop before the CLI is found starts no child', async () => {
    const { children, heard, follow } = rig()
    follow(['tasks']).stop()
    await settle()
    expect([children.length, heard]).toEqual([0, []])
  })
})
