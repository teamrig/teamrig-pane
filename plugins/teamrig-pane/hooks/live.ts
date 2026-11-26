// Keeps the session's snapshot in step with the register's files, at no model-token cost:
// each refresh (the refresher's, register-subject.ts) re-reads only a file whose size or mtime moved, and a TICK_MS
// tick moves the due/age labels on. Each write of the snapshot redraws the pane, so a poll or
// tick whose snapshot would draw the same pane (view.ts sameView) writes nothing. A per-session pin (/teamrig-pane <area>) is kept in $.store,
// so a resumed session keeps it.
// The session id is read on every poll: after /clear the process goes on under a new id
// and no session.start fires, so an id captured once would follow the old session.
// The engine allows $ only at its call sites in a hook, so session.start hands this class
// ports built from $ calls rather than $ itself.
// Neither a refresh nor the tick ever rejects: a failed poll or tick shows as the pane's problem over the last good
// tasks, and when even that write fails the pane stays as last drawn and the next poll tries again.
import type { Snapshot } from '../types'
import { SESSION_NAME } from './core/read/index'
import { messageOf } from './errors'
import type { SnapshotSource } from './document-source'
import type { StreamMarks } from './source'
import { sameView } from './view'

export const POLL_MS = 3_000
export const TICK_MS = 60_000

export type Timer = { cancel: () => void }

export type LivePorts = {
  /** What answers the snapshot (document-source.ts), or the problem the pane shows while nothing names where the register is (places.ts). */
  source: SnapshotSource | { missing: string }
  sessionId: () => Promise<string>
  now: () => Promise<number>
  /** Writes the snapshot atom (each write redraws the pane). */
  publish: (change: (current: Snapshot) => Snapshot) => Promise<void>
  /** The session's stored pin, as $.store.get answers it. */
  loadPin: (claudeSession: string) => Promise<unknown>
  /** Saves (or with null clears) the session's pin. */
  savePin: (claudeSession: string, area: string | null) => Promise<void>
}

export function pinKey(claudeSession: string): string {
  return `pin:${claudeSession}`
}

/** A stored pin, if it is still a valid area name. */
export function storedPin(value: unknown): string | null {
  return typeof value === 'string' && SESSION_NAME.test(value) ? value : null
}

type BoundSession = { id: string; pinned: string | null }

/** Refreshes joined for one poll: followed only when each of them was, with every document any of them marked. */
type JoinedAsk = { isFollowed: boolean; readonly marked: Set<string> }

export class LiveRegister {
  private timers: Timer[] = []
  /** The poll under way, which every refresh asked meanwhile awaits; null when none runs. */
  private polling: Promise<boolean> | null = null
  /** Set by a refresh asked while a poll runs, so that poll reads once more when it ends. */
  private isRerunAsked = false
  /** What the refreshes asked since the last poll began told of the stream, joined; null when none was asked. */
  private asked: JoinedAsk | null = null
  private session: BoundSession | null = null
  /** Set after a failed poll, a new pin or a new session, so the next good poll redraws even when no file moved. */
  private mustPublish = true
  /** The snapshot it last wrote; null until its first write (a hot reload starts it over). */
  private shown: Snapshot | null = null
  private readonly ports: LivePorts

  constructor(ports: LivePorts) {
    this.ports = ports
  }

  /** Starts the label tick on the engine's clock; it never rejects. When the register is read is the refresher's. */
  startTick(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(TICK_MS, () => void this.tick())]
  }

  /** Moves `now` on, writing only when a due, NEW/NOT PICKED UP or finished label changes with it. */
  async tick(): Promise<void> {
    try {
      const now = await this.ports.now()
      if (this.shown !== null && sameView(this.shown, { ...this.shown, now })) return
      await this.write(s => ({ ...s, now }))
    } catch (error) {
      this.mustPublish = true
      await this.showProblem(messageOf(error))
    }
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  /**
   * Polls the source and draws what changed. Answers whether the last poll worked: false with no source or when it
   * threw (its reason drawn). A refresh asked while a poll runs joins it, and that poll reads once more when it ends:
   * the read under way may have started before the pin or the file move that asked for this one. `stream` is what a
   * live stream serving every register document marked (register-subject.ts); a refresh without it, a pin's or one
   * while no stream is live, has the next poll read as the files say.
   */
  refresh(stream?: StreamMarks): Promise<boolean> {
    this.join(stream)
    if (this.polling !== null) {
      this.isRerunAsked = true
      return this.polling
    }
    this.polling = this.pollUntilSettled().finally(() => {
      this.polling = null
    })
    return this.polling
  }

  private join(stream: StreamMarks | undefined): void {
    const asked = this.asked
    if (asked === null) {
      this.asked = { isFollowed: stream !== undefined, marked: new Set(stream?.marked ?? []) }
      return
    }
    asked.isFollowed = asked.isFollowed && stream !== undefined
    for (const document of stream?.marked ?? []) asked.marked.add(document)
  }

  /** The joined asks for the poll starting now, cleared for the refreshes asked during it. */
  private takeStream(): StreamMarks | undefined {
    const asked = this.asked
    this.asked = null
    return asked !== null && asked.isFollowed ? { marked: [...asked.marked] } : undefined
  }

  private async pollUntilSettled(): Promise<boolean> {
    let worked: boolean
    do {
      this.isRerunAsked = false
      worked = await this.pollOnce()
    } while (this.isRerunAsked)
    return worked
  }

  private async pollOnce(): Promise<boolean> {
    try {
      const source = this.ports.source
      if ('missing' in source) {
        await this.showProblem(source.missing)
        return false
      }
      const session = await this.currentSession()
      const now = await this.ports.now()
      // Taken before the read, so a pin or new session that sets it during the read still forces the next one.
      const force = this.mustPublish
      this.mustPublish = false
      const stream = this.takeStream()
      const next = await source.poll({ claudeSession: session.id, pinned: session.pinned, now, force, stream })
      if (next && (this.shown === null || !sameView(this.shown, next))) await this.write(() => next)
      return true
    } catch (error) {
      this.mustPublish = true
      await this.showProblem(messageOf(error))
      return false
    }
  }

  /** Pins this session to `area`, or with null follows its `inbox read` (or the tab-title binding, which writes the same mark) again. */
  async pin(area: string | null): Promise<void> {
    const session = await this.currentSession()
    await this.ports.savePin(session.id, area)
    this.session = { id: session.id, pinned: area }
    this.mustPublish = true
    await this.refresh()
  }

  private async currentSession(): Promise<BoundSession> {
    const id = await this.ports.sessionId()
    if (this.session?.id === id) return this.session
    this.session = { id, pinned: storedPin(await this.ports.loadPin(id)) }
    this.mustPublish = true
    return this.session
  }

  /** Shows `problem` over the last good tasks; a write that fails too is left to the next poll (mustPublish is set). */
  private async showProblem(problem: string): Promise<void> {
    if (this.shown?.problem === problem) return
    try {
      await this.write(s => ({ ...s, problem }))
    } catch {
      // Nothing is left to draw it with: the pane keeps its last frame, never a blank one.
    }
  }

  /** Publishes `change`, remembering what it wrote only once the write landed (a retried write applies it again). */
  private async write(change: (current: Snapshot) => Snapshot): Promise<void> {
    const written: { last: Snapshot | null } = { last: null }
    await this.ports.publish(current => {
      written.last = change(current)
      return written.last
    })
    if (written.last !== null) this.shown = written.last
  }
}
