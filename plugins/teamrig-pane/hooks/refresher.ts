// Decides when each view reads again (T4760), in place of a poll per view. It follows teamrig's event stream
// (change-feed.ts) and reads a view's documents when a frame marks one of them with a revision the view does not hold.
// A read costs a start of the CLI (about half a second of CPU before any work), and a busy team changes something
// every few seconds, so the first change reads at once and later ones wait out GAP_MS from that read's start; a view
// that is not drawn is left stale and read when it is shown. A mark is weighed when the read would start, not when it
// arrives: a read under way often brings the marked revision itself, and the mark then asks for nothing.
// The stream is a saving, never the only way: until a stream says hello, and for a view with a document the stream
// does not serve, a tick every POLL_MS reads as U1's poll did (each read hands back the revisions held, so an
// unchanged document costs the start alone). The same tick reads a view whose last read failed, a view that also
// draws from what no document serves (`polls`: the team's files beneath the documents), and picks up a view shown
// without `viewChanged` being told. A stream that ends is followed again after a wait that doubles from
// RESTART_MIN_MS to RESTART_MAX_MS and starts over once a stream stayed open that long, so a follower that dies at
// its start is not started every second. Runs nothing itself: reads and the stream are its ports.
import type { Every } from './bounded-run'
import type { ChangeFeed, DocumentMark, FeedEnd, FeedFrame, FeedHandle } from './change-feed'
import type { Timer } from './live'

/** The least time from one read of a view to its next. */
export const GAP_MS = 5_000
/** How often a view reads while no stream tells it when to. */
export const POLL_MS = 10_000
export const RESTART_MIN_MS = 1_000
export const RESTART_MAX_MS = 60_000

/** One view's reader, as the refresher drives it. */
export type Subject = {
  /** The documents its view draws from, by the names `teamrig events` takes; at least one. */
  readonly documents: readonly string[]
  /** True when its view also draws from what no document serves: the tick reads it while a stream is live too. */
  readonly polls: boolean
  /** True while its view is drawn. A rejection is taken as not drawn. */
  readonly isShown: () => Promise<boolean>
  /** The revision it holds of `document`; null when none. */
  readonly held: (document: string) => string | null
  /** Reads its documents again and draws them; answers whether the read worked. A rejection is taken as a failed read. */
  readonly refresh: () => Promise<boolean>
}

export type RefresherPorts = {
  readonly feed: ChangeFeed
  /** A repeating timer, as `$.clock.every` starts one. */
  readonly every: Every
}

/** Whether a stream tells the views when to read, and why its frames could not be read, for the pane to say. */
export type FeedState = { readonly isLive: boolean; readonly problems: readonly string[] }

type Tracked = {
  readonly subject: Subject
  /** The marks frames gave its documents since its last read began, the newest of each. */
  readonly marks: Map<string, string | null>
  /** True when it must read whatever it holds: at the start, on a poll tick. */
  mustRead: boolean
  /** True from the check that it is drawn to the end of its read. */
  isBusy: boolean
  hasFailed: boolean
  /** Runs from a read's start; null once GAP_MS passed. */
  gap: Timer | null
}

/** One start-to-stop life: what a late timer or answer of an earlier one must not touch. */
type Run = {
  readonly tracked: readonly Tracked[]
  readonly timers: Set<Timer>
  /** The stream followed now, by a token of its own: a frame of an ended one is dropped. */
  stream: object | null
  handle: FeedHandle | null
  isLive: boolean
  /** The documents the stream said it serves. */
  served: ReadonlySet<string>
  restartMs: number
  /** Runs while a stream is open, to RESTART_MAX_MS: at its fire the restart wait starts over. */
  steady: Timer | null
  readonly problems: Set<string>
}

/** A subject as a run starts it: to be read at once. */
function tracking(subject: Subject): Tracked {
  return { subject, marks: new Map(), mustRead: true, isBusy: false, hasFailed: false, gap: null }
}

async function isDrawn(subject: Subject): Promise<boolean> {
  try {
    return await subject.isShown()
  } catch {
    return false
  }
}

async function hasRead(subject: Subject): Promise<boolean> {
  try {
    return await subject.refresh()
  } catch {
    return false
  }
}

export class Refresher {
  private readonly ports: RefresherPorts
  private readonly subjects: readonly Subject[]
  private run: Run | null = null

  constructor(ports: RefresherPorts, subjects: readonly Subject[]) {
    this.ports = ports
    this.subjects = subjects
  }

  /** Reads every drawn view at once, follows the stream and starts the poll tick. */
  start(): void {
    this.stop()
    const run: Run = {
      tracked: this.subjects.map(tracking),
      timers: new Set(),
      stream: null,
      handle: null,
      isLive: false,
      served: new Set(),
      restartMs: RESTART_MIN_MS,
      steady: null,
      problems: new Set(),
    }
    this.run = run
    run.timers.add(this.ports.every(POLL_MS, () => this.tick(run)))
    this.pumpAll(run)
    this.follow(run)
  }

  /** Ends the stream and every timer; a read under way finishes and starts nothing more. */
  stop(): void {
    const run = this.run
    if (run === null) return
    this.run = null
    for (const timer of run.timers) timer.cancel()
    run.timers.clear()
    run.stream = null
    run.handle?.stop()
    run.handle = null
  }

  /** Tells that what is drawn changed (a switch of view, the dock opened): a view left stale while hidden reads now. */
  viewChanged(): void {
    if (this.run !== null) this.pumpAll(this.run)
  }

  feedState(): FeedState {
    return { isLive: this.run?.isLive ?? false, problems: [...(this.run?.problems ?? [])] }
  }

  /** A timer that fires once, kept with the run so `stop` cancels it. */
  private once(run: Run, ms: number, fn: () => void): Timer {
    const timer = this.ports.every(ms, () => {
      timer.cancel()
      run.timers.delete(timer)
      fn()
    })
    run.timers.add(timer)
    return timer
  }

  private drop(run: Run, timer: Timer | null): void {
    if (timer === null) return
    timer.cancel()
    run.timers.delete(timer)
  }

  private follow(run: Run): void {
    const stream = {}
    run.stream = stream
    const isCurrent = (): boolean => this.run === run && run.stream === stream
    const documents = [...new Set(run.tracked.flatMap(tracked => tracked.subject.documents))]
    const handle = this.ports.feed.follow(documents, {
      onFrame: frame => {
        if (isCurrent()) this.take(run, frame)
      },
      onProblem: reason => {
        if (isCurrent()) run.problems.add(reason)
      },
      onEnd: end => {
        if (isCurrent()) this.ended(run, end)
      },
    })
    // A stream that could not start has ended already, inside `follow`: its handle is not kept.
    if (isCurrent()) run.handle = handle
  }

  private take(run: Run, frame: FeedFrame): void {
    if (frame.event === 'hello') {
      run.isLive = true
      run.served = new Set(frame.documents.map(mark => mark.document))
      run.problems.clear()
      this.drop(run, run.steady)
      run.steady = this.once(run, RESTART_MAX_MS, () => {
        run.steady = null
        run.restartMs = RESTART_MIN_MS
      })
    }
    for (const tracked of run.tracked) this.mark(tracked, frame.documents)
    this.pumpAll(run)
  }

  private mark(tracked: Tracked, marks: readonly DocumentMark[]): void {
    for (const { document, revision } of marks) {
      if (tracked.subject.documents.includes(document)) tracked.marks.set(document, revision)
    }
  }

  private ended(run: Run, end: FeedEnd): void {
    run.stream = null
    run.handle = null
    run.isLive = false
    run.served = new Set()
    this.drop(run, run.steady)
    run.steady = null
    if (end === 'unavailable') return
    this.once(run, run.restartMs, () => this.follow(run))
    run.restartMs = Math.min(run.restartMs * 2, RESTART_MAX_MS)
  }

  private tick(run: Run): void {
    for (const tracked of run.tracked) {
      const isUnserved = tracked.subject.documents.some(document => !run.served.has(document))
      if (!run.isLive || isUnserved || tracked.hasFailed || tracked.subject.polls) tracked.mustRead = true
    }
    this.pumpAll(run)
  }

  private pumpAll(run: Run): void {
    for (const tracked of run.tracked) void this.pump(run, tracked)
  }

  /** Whether `tracked` has something to read: a forced read, or a mark its subject does not hold; marks it holds go. */
  private isStale(tracked: Tracked): boolean {
    for (const [document, revision] of tracked.marks) {
      if (revision !== null && tracked.subject.held(document) === revision) tracked.marks.delete(document)
    }
    return tracked.mustRead || tracked.marks.size > 0
  }

  /** Reads `tracked` when it is stale, drawn, not reading and past its gap; else leaves it as it is. */
  private async pump(run: Run, tracked: Tracked): Promise<void> {
    if (this.run !== run || tracked.isBusy || tracked.gap !== null || !this.isStale(tracked)) return
    tracked.isBusy = true
    let didRead = false
    try {
      if (!(await isDrawn(tracked.subject)) || this.run !== run) return
      tracked.mustRead = false
      tracked.marks.clear()
      tracked.gap = this.once(run, GAP_MS, () => {
        tracked.gap = null
        void this.pump(run, tracked)
      })
      didRead = true
      tracked.hasFailed = !(await hasRead(tracked.subject))
    } finally {
      tracked.isBusy = false
    }
    // A read longer than the gap: the gap's own fire found it busy, so what was marked meanwhile reads now.
    if (didRead) void this.pump(run, tracked)
  }
}
