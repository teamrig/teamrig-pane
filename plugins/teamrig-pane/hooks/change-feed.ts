// What the pane reads off teamrig's event stream (T4760): one JSON frame per line, each carrying the interface
// version, telling that something changed and never what (ids and revisions only; the text comes through a read). The
// pane takes two frames. `hello` opens a stream and marks each document it serves with its revision; `changed` marks
// the documents that went stale. A revision is the one `teamrig read --unless` takes, so a reader holding it already
// has nothing to read again. A minor version adds frames and fields, which are passed over, never a problem; a frame
// of another major is not read at all, as its words may mean something else. The stream arrives in pieces cut
// anywhere, so LineSplitter holds a line until its end arrives, and drops one too long to be a frame instead of
// growing with it. ChangeFeed is the port a transport serves: the dock's follower process, the dedicated UI's, a
// test's script. Parses text only; runs nothing.

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The interface major whose frames the pane reads, at any minor. */
export const FEED_MAJOR = 1

const VERSION = /^(\d{1,9})\.(\d{1,9})$/

/** A document a frame names, with teamrig's mark of what it is built from now; null when the frame gives none. */
export type DocumentMark = { readonly document: string; readonly revision: string | null }

export type FeedFrame = {
  /** `hello`: the stream is open and serves these documents. `changed`: these went stale. */
  readonly event: 'hello' | 'changed'
  readonly documents: readonly DocumentMark[]
}

/** One printed value read: a frame, one the pane has no use for (passed over), or why it cannot be read. */
export type FrameRead =
  | { readonly kind: 'frame'; readonly frame: FeedFrame }
  | { readonly kind: 'passed-over' }
  | { readonly kind: 'unreadable'; readonly reason: string }

function unreadable(reason: string): FrameRead {
  return { kind: 'unreadable', reason }
}

/** Why a frame of another major is not read: the older side is the one to update. */
function otherMajor(version: string, major: number): string {
  const side = major > FEED_MAJOR ? 'newer than the pane reads: update teamrig-pane' : 'older than the pane reads: update teamrig'
  return `teamrig sent events of interface ${version}, ${side}`
}

/** The marks in `value`; an entry that names no document is passed over, a revision that is no text is none. */
function marksOf(value: readonly unknown[]): DocumentMark[] {
  const marks: DocumentMark[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const { document, revision } = entry
    if (typeof document === 'string' && document !== '') marks.push({ document, revision: typeof revision === 'string' ? revision : null })
  }
  return marks
}

/**
 * The frame `value` is. The version is checked before the event's name: under another major even a known name may
 * mean something else.
 */
export function parseFrame(value: unknown): FrameRead {
  if (!isRecord(value)) return unreadable('teamrig sent an event that is no frame')
  const { interface: version, event, documents } = value
  const match = typeof version === 'string' ? VERSION.exec(version) : null
  if (typeof version !== 'string' || match === null) return unreadable('teamrig sent an event with no interface version')
  const major = Number(match[1])
  if (major !== FEED_MAJOR) return unreadable(otherMajor(version, major))
  if (event !== 'hello' && event !== 'changed') return { kind: 'passed-over' }
  if (!Array.isArray(documents)) return unreadable(`teamrig sent a ${event} event naming no documents`)
  return { kind: 'frame', frame: { event, documents: marksOf(documents) } }
}

/** The frame one line of the stream holds. */
export function frameOfLine(line: string): FrameRead {
  try {
    const value: unknown = JSON.parse(line)
    return parseFrame(value)
  } catch {
    return unreadable('teamrig sent an event that is no JSON')
  }
}

/** A frame holds ids and revisions, a few hundred characters: a line past this is none, and is dropped unread. */
export const MAX_LINE_CHARS = 65_536

/** What a piece completed: its whole lines, trimmed, blank ones left out; and how many lines too long to keep ended. */
export type SplitLines = { readonly lines: readonly string[]; readonly dropped: number }

/** Joins a stream's pieces into lines: a piece may end anywhere, inside a line or between a `\r` and its `\n`. */
export class LineSplitter {
  /** The start of a line whose end has not arrived. */
  private held = ''
  /** True while the line arriving is already past MAX_LINE_CHARS: the rest of it is dropped as it comes. */
  private isDropping = false

  push(piece: string): SplitLines {
    const lines: string[] = []
    let dropped = 0
    const parts = piece.split('\n')
    const tail = parts.pop() ?? ''
    for (const part of parts) {
      const line = this.held + part
      this.held = ''
      if (this.isDropping || line.length > MAX_LINE_CHARS) {
        this.isDropping = false
        dropped += 1
        continue
      }
      const trimmed = line.trim()
      if (trimmed !== '') lines.push(trimmed)
    }
    if (!this.isDropping) {
      this.held += tail
      if (this.held.length > MAX_LINE_CHARS) {
        this.held = ''
        this.isDropping = true
      }
    }
    return { lines, dropped }
  }
}

/** Who hears a stream: each frame the pane takes, and each reason another could not be read, told once. */
export type FrameSink = {
  readonly onFrame: (frame: FeedFrame) => void
  readonly onProblem: (reason: string) => void
}

/** A reader of one stream: hand it each piece as it arrives, and `sink` hears what the pieces complete. */
export function frameReader(sink: FrameSink): (piece: string) => void {
  const splitter = new LineSplitter()
  const told = new Set<string>()
  const tell = (reason: string): void => {
    if (told.has(reason)) return
    told.add(reason)
    sink.onProblem(reason)
  }
  return piece => {
    const { lines, dropped } = splitter.push(piece)
    if (dropped > 0) tell('teamrig sent an event too long to be one')
    for (const line of lines) {
      const read = frameOfLine(line)
      if (read.kind === 'frame') sink.onFrame(read.frame)
      if (read.kind === 'unreadable') tell(read.reason)
    }
  }
}

/** How a stream ended: `ended` may be followed again later; `unavailable` cannot be, here, until the pane reloads. */
export type FeedEnd = 'ended' | 'unavailable'

export type FeedListener = FrameSink & {
  /** Told once, after the last frame; never after `stop`. */
  readonly onEnd: (end: FeedEnd) => void
}

/** A stream being followed; `stop` ends it, and its listener hears nothing more. */
export type FeedHandle = { readonly stop: () => void }

/** The event stream, however it is carried. A stream that cannot start ends at once, through `onEnd`; never a throw. */
export type ChangeFeed = {
  readonly follow: (documents: readonly string[], listener: FeedListener) => FeedHandle
}

/** The feed where nothing can be followed (no register found): each stream ends `unavailable` at once. */
export const NO_FEED: ChangeFeed = {
  follow: (_documents, listener) => {
    listener.onEnd('unavailable')
    return { stop: () => undefined }
  },
}
