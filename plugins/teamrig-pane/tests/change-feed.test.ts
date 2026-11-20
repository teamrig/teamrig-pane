// teamrig's event stream as the pane reads it (hooks/change-feed.ts): a hello or changed frame of the served major is
// taken with the documents it marks; other frames and fields are passed over; another major, a missing version or a
// line that is no frame is told as a reason, once; and a stream cut anywhere, even inside a line ending, comes out as
// whole lines, one too long to be a frame dropped unread (T4760).
import { describe, expect, test } from 'claude-code/testing'
import { LineSplitter, MAX_LINE_CHARS, frameOfLine, frameReader, parseFrame, type FeedFrame } from '../hooks/change-feed'

const HELLO = { interface: '1.1', event: 'hello', documents: [{ document: 'tasks', revision: 'r7' }, { document: 'inbox', revision: 'r2' }] }
const CHANGED = { interface: '1.1', event: 'changed', documents: [{ document: 'tasks', revision: 'r8' }] }

/** A sink recording what a reader tells it. */
function recorder(): { frames: FeedFrame[]; problems: string[]; onFrame: (frame: FeedFrame) => void; onProblem: (reason: string) => void } {
  const frames: FeedFrame[] = []
  const problems: string[] = []
  return { frames, problems, onFrame: frame => frames.push(frame), onProblem: reason => problems.push(reason) }
}

describe('parseFrame', () => {
  test('takes a hello and a changed frame with the documents they mark', () => {
    expect(parseFrame(HELLO)).toEqual({
      kind: 'frame',
      frame: { event: 'hello', documents: [{ document: 'tasks', revision: 'r7' }, { document: 'inbox', revision: 'r2' }] },
    })
    expect(parseFrame(CHANGED)).toEqual({ kind: 'frame', frame: { event: 'changed', documents: [{ document: 'tasks', revision: 'r8' }] } })
  })

  test('reads any minor of the served major, passing over fields it does not know', () => {
    expect(parseFrame({ ...CHANGED, interface: '1.9', team: 'alpha' })).toEqual({
      kind: 'frame',
      frame: { event: 'changed', documents: [{ document: 'tasks', revision: 'r8' }] },
    })
  })

  test('a mark with no revision has none; an entry naming no document is passed over', () => {
    const documents = [{ document: 'tasks' }, { document: 'inbox', revision: 4 }, { revision: 'r1' }, { document: '' }, 'tasks', null]
    expect(parseFrame({ interface: '1.0', event: 'changed', documents })).toEqual({
      kind: 'frame',
      frame: { event: 'changed', documents: [{ document: 'tasks', revision: null }, { document: 'inbox', revision: null }] },
    })
  })

  test('passes over a frame the pane has no use for', () => {
    expect(parseFrame({ interface: '1.1', event: 'task', id: 'T12', status: 'waiting' })).toEqual({ kind: 'passed-over' })
    expect(parseFrame({ interface: '1.1' })).toEqual({ kind: 'passed-over' })
  })

  test('does not read a frame of another major, and says which side to update', () => {
    expect(parseFrame({ ...HELLO, interface: '2.0' })).toEqual({
      kind: 'unreadable',
      reason: 'teamrig sent events of interface 2.0, newer than the pane reads: update teamrig-pane',
    })
    expect(parseFrame({ ...HELLO, interface: '0.4' })).toEqual({
      kind: 'unreadable',
      reason: 'teamrig sent events of interface 0.4, older than the pane reads: update teamrig',
    })
  })

  test('a frame with no version it can read, or no frame at all, is unreadable', () => {
    const noVersion = { kind: 'unreadable', reason: 'teamrig sent an event with no interface version' }
    expect(parseFrame({ event: 'hello', documents: [] })).toEqual(noVersion)
    expect(parseFrame({ ...HELLO, interface: 1.1 })).toEqual(noVersion)
    expect(parseFrame({ ...HELLO, interface: '1' })).toEqual(noVersion)
    for (const value of [null, 'hello', 7, [HELLO]]) {
      expect(parseFrame(value)).toEqual({ kind: 'unreadable', reason: 'teamrig sent an event that is no frame' })
    }
  })

  test('a hello or changed frame with no list of documents is unreadable', () => {
    expect(parseFrame({ interface: '1.1', event: 'changed' })).toEqual({ kind: 'unreadable', reason: 'teamrig sent a changed event naming no documents' })
    expect(parseFrame({ interface: '1.1', event: 'hello', documents: 'tasks' })).toEqual({ kind: 'unreadable', reason: 'teamrig sent a hello event naming no documents' })
  })
})

describe('frameOfLine', () => {
  test('reads a line of JSON as its frame, and says so of one that is none', () => {
    expect(frameOfLine(JSON.stringify(CHANGED))).toEqual(parseFrame(CHANGED))
    expect(frameOfLine('{"interface":"1.1","event":')).toEqual({ kind: 'unreadable', reason: 'teamrig sent an event that is no JSON' })
  })
})

describe('LineSplitter', () => {
  test('holds a line until its end arrives, wherever the pieces are cut', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('{"a"')).toEqual({ lines: [], dropped: 0 })
    expect(splitter.push(':1}\n{"b":')).toEqual({ lines: ['{"a":1}'], dropped: 0 })
    expect(splitter.push('2}\n{"c":3}\n')).toEqual({ lines: ['{"b":2}', '{"c":3}'], dropped: 0 })
    expect(splitter.push('')).toEqual({ lines: [], dropped: 0 })
  })

  test('takes a line ending cut between its two characters, and leaves blank lines out', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('one\r')).toEqual({ lines: [], dropped: 0 })
    expect(splitter.push('\n\r\n  \ntwo\r\n')).toEqual({ lines: ['one', 'two'], dropped: 0 })
  })

  test('drops a line past the longest a frame can be, in one piece or many, and reads the next', () => {
    const whole = new LineSplitter()
    expect(whole.push(`${'x'.repeat(MAX_LINE_CHARS + 1)}\nnext\n`)).toEqual({ lines: ['next'], dropped: 1 })

    const cut = new LineSplitter()
    expect(cut.push('x'.repeat(MAX_LINE_CHARS))).toEqual({ lines: [], dropped: 0 })
    expect(cut.push('xx')).toEqual({ lines: [], dropped: 0 })
    expect(cut.push('x'.repeat(MAX_LINE_CHARS))).toEqual({ lines: [], dropped: 0 })
    expect(cut.push('end\nnext\nhe')).toEqual({ lines: ['next'], dropped: 1 })
    expect(cut.push('ld\n')).toEqual({ lines: ['held'], dropped: 0 })
  })

  test('keeps a line of exactly the longest length', () => {
    const line = 'x'.repeat(MAX_LINE_CHARS)
    expect(new LineSplitter().push(`${line}\n`)).toEqual({ lines: [line], dropped: 0 })
  })
})

describe('frameReader', () => {
  test('hands on each frame as the pieces complete it, in order', () => {
    const heard = recorder()
    const read = frameReader(heard)
    const text = `${JSON.stringify(HELLO)}\n${JSON.stringify(CHANGED)}\n`
    read(text.slice(0, 30))
    expect(heard.frames).toEqual([])
    read(text.slice(30, 120))
    read(text.slice(120))
    expect(heard.frames.map(frame => frame.event)).toEqual(['hello', 'changed'])
    expect(heard.problems).toEqual([])
  })

  test('passes over frames it has no use for, and tells each reason a line could not be read once', () => {
    const heard = recorder()
    const read = frameReader(heard)
    read('not json\n{"interface":"1.1","event":"session","id":"alpha","unread":2}\nalso not json\n')
    read(`${JSON.stringify({ ...HELLO, interface: '2.0' })}\n${JSON.stringify(CHANGED)}\n`)
    read(`${'x'.repeat(MAX_LINE_CHARS + 1)}\n${'y'.repeat(MAX_LINE_CHARS + 1)}\n`)
    expect(heard.frames).toEqual([{ event: 'changed', documents: [{ document: 'tasks', revision: 'r8' }] }])
    expect(heard.problems).toEqual([
      'teamrig sent an event that is no JSON',
      'teamrig sent events of interface 2.0, newer than the pane reads: update teamrig-pane',
      'teamrig sent an event too long to be one',
    ])
  })
})
