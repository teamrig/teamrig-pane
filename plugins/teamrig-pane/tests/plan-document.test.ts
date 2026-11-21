// The team's plan from teamrig's `plan` document (hooks/plan-document.ts): a planned task reads field by field into
// the place the views rank by, its dates as moments, in the order served; each kind of next move reads with its own
// fields and one of a kind the pane does not know as unknown; a field a later minor adds is passed over; a planned or
// finished task with a field of another type is left out and told in one line per list; a document with no judging
// time or no list is unreadable (T4759).
import { describe, expect, test } from 'claude-code/testing'
import { planOf, type PlanRead, type PlannedTask } from '../hooks/plan-document'
import { parseDocument, type JsonRecord, type ReadDocument } from '../hooks/read-document'
import { shownText } from '../hooks/shown-text'
import { planDocument, planned } from './served-documents'

const AT = '2026-03-02T09:00:00.000Z'
const DUE_AT = '2026-03-09T22:00:00.000Z'
const WAIT_AT = '2026-03-03T08:00:00.000Z'

/** A planned task with every field set (teamrig src/interface/plan.ts PlannedTask). */
function served(over: JsonRecord = {}): JsonRecord {
  return planned('T7', {
    parked: true,
    pinned: true,
    band: 0,
    ready: false,
    score: 56,
    started: true,
    due: { due: '2026-03-09', at: DUE_AT, from: 'T9' },
    unblocks: { first: 'T9', priority: 0, count: 2 },
    inWeek: true,
    size: 1.5,
    costOfDelay: 140,
    sizePct: 2.5,
    workClass: 'Roadmap',
    goal: { tag: 'G2', rank: 1 },
    prep: true,
    needs: [
      { id: 'T3', team: null, owner: 'web', status: 'in-progress' },
      { id: 'T40', team: 'ops', owner: 'infra', status: 'open' },
      { id: 'T1', team: null, owner: null, status: null },
    ],
    neededBy: [
      { id: 'T9', owner: 'web', due: { due: '2026-03-09', at: DUE_AT, from: null } },
      { id: 'T12', owner: 'lead', due: null },
    ],
    next: { kind: 'work', who: 'web', task: 'T3', behind: 'T2' },
    ...over,
  })
}

/** `served()` as the place it reads into. */
const PLACE: PlannedTask = {
  id: 'T7',
  parked: true,
  pinned: true,
  band: 0,
  ready: false,
  score: 56,
  started: true,
  due: { due: '2026-03-09', at: Date.parse(DUE_AT), from: 'T9' },
  unblocks: { first: 'T9', priority: 0, count: 2 },
  inWeek: true,
  size: 1.5,
  costOfDelay: 140,
  sizePct: 2.5,
  workClass: 'Roadmap',
  goal: { tag: 'G2', rank: 1 },
  prep: true,
  needs: [
    { id: 'T3', team: null, owner: 'web', status: 'in-progress' },
    { id: 'T40', team: 'ops', owner: 'infra', status: 'open' },
    { id: 'T1', team: null, owner: null, status: null },
  ],
  neededBy: [
    { id: 'T9', owner: 'web', due: { due: '2026-03-09', at: Date.parse(DUE_AT), from: null } },
    { id: 'T12', owner: 'lead', due: null },
  ],
  next: { kind: 'work', who: 'web', task: 'T3', behind: 'T2' },
}

function documentOf(tasks: readonly unknown[], over: JsonRecord = {}): ReadDocument {
  const read = parseDocument({ ...planDocument('p1', [], { at: AT, ...over }), tasks })
  if (read.kind !== 'document') throw new Error(`the fixture is no document: ${read.kind}`)
  return read.document
}

/** What the reader makes of a document; fails the test on one it could not read at all. */
function readOf(document: ReadDocument): { plan: PlanRead; problems: readonly string[] } {
  const read = planOf(document)
  if (read.kind !== 'read') throw new Error(read.reason)
  return { plan: read.value, problems: read.problems }
}

function placeOf(over: JsonRecord): PlannedTask | undefined {
  return readOf(documentOf([served(over)])).plan.tasks[0]
}

function unreadable(why: string): { kind: 'unreadable'; reason: string } {
  return { kind: 'unreadable', reason: `teamrig's plan document ${why}` }
}

describe('planOf', () => {
  test('reads a planned task field by field, its dates as moments', () => {
    expect(readOf(documentOf([served()]))).toEqual({ plan: { at: Date.parse(AT), validUntil: null, week: null, tasks: [PLACE], finished: [] }, problems: [] })
  })

  test('reads the judging time, the moment the plan stands until, the week and the finished tasks', () => {
    const finished = [
      { id: 'T2', workClass: 'Roadmap' },
      { id: 'T5', workClass: 'Upkeep' },
    ]
    const { plan, problems } = readOf(documentOf([], { validUntil: DUE_AT, week: '2026-03-02', finished }))
    expect(plan).toEqual({ at: Date.parse(AT), validUntil: Date.parse(DUE_AT), week: '2026-03-02', tasks: [], finished })
    expect(problems).toEqual([])
  })

  test('keeps the order served, which is the rank, whatever the ids say', () => {
    const { plan } = readOf(documentOf([planned('T9'), planned('T2'), planned('T30')]))
    expect(plan.tasks.map(task => task.id)).toEqual(['T9', 'T2', 'T30'])
  })

  test('reads a task with every optional field unset', () => {
    const bare = placeOf({ due: null, unblocks: null, size: null, goal: null, needs: [], neededBy: [], next: null })
    expect(bare).toEqual({ ...PLACE, due: null, unblocks: null, size: null, goal: null, needs: [], neededBy: [], next: null })
  })

  test('reads each kind of next move with its own fields', () => {
    expect(placeOf({ next: { kind: 'decision', who: 'owner', task: 'T7', behind: null } })?.next).toEqual({ kind: 'decision', who: 'owner', task: 'T7', behind: null })
    expect(placeOf({ next: { kind: 'approval', who: 'lead', task: 'T3', behind: null } })?.next).toEqual({ kind: 'approval', who: 'lead', task: 'T3', behind: null })
    expect(placeOf({ next: { kind: 'time', who: 'api', task: 'T7', behind: 'T2', at: WAIT_AT } })?.next).toEqual({ kind: 'time', who: 'api', task: 'T7', behind: 'T2', at: Date.parse(WAIT_AT) })
    expect(placeOf({ next: { kind: 'elsewhere', who: 'infra', task: 'T7', team: 'ops', need: 'T40' } })?.next).toEqual({ kind: 'elsewhere', who: 'infra', task: 'T7', team: 'ops', need: 'T40' })
  })

  test('keeps a time move whose stored time teamrig could not read as a moment, with no time', () => {
    const { plan, problems } = readOf(documentOf([served({ next: { kind: 'time', who: 'api', task: 'T7', behind: null, at: 'next spring' } })]))
    expect(plan.tasks[0]?.next).toEqual({ kind: 'time', who: 'api', task: 'T7', behind: null, at: null })
    expect(problems).toEqual([])
  })

  test('reads a move of a kind a later minor added as unknown, the task kept', () => {
    const { plan, problems } = readOf(documentOf([served({ next: { kind: 'vote', who: 'lead', task: 'T7', quorum: 3 } })]))
    expect(plan.tasks[0]).toEqual({ ...PLACE, next: { kind: 'unknown' } })
    expect(problems).toEqual([])
  })

  test('passes over a field a later minor adds, on the document, a task and the records in it', () => {
    const task = served({ lane: 'fast', due: { due: '2026-03-09', at: DUE_AT, from: 'T9', slack: 2 }, goal: { tag: 'G2', rank: 1, title: 'Ship' } })
    expect(readOf(documentOf([task], { horizon: 14 }))).toEqual({ plan: { at: Date.parse(AT), validUntil: null, week: null, tasks: [PLACE], finished: [] }, problems: [] })
  })

  test('hands every text out as the pane may draw it', () => {
    const place = placeOf({ id: 'T\u001b7', workClass: 'Road\u009bmap', next: { kind: 'work', who: 'we\u001bb', task: 'T3', behind: null } })
    expect(place?.id).toBe(shownText('T\u001b7'))
    expect(place?.id).not.toBe('T\u001b7')
    expect(place?.workClass).toBe(shownText('Road\u009bmap'))
    expect(place?.next).toEqual({ kind: 'work', who: shownText('we\u001bb'), task: 'T3', behind: null })
  })

  test('leaves out a planned task with a field of another type and tells them in one line, the others kept in order', () => {
    const tasks = [
      planned('T1'),
      served({ score: '56' }),
      'T8',
      planned('T4', { id: 4 }),
      planned('T5', { due: { due: '2026-03-09', at: 'soon', from: null } }),
      planned('T6', { needs: ['T3'] }),
      planned('T2'),
    ]
    const { plan, problems } = readOf(documentOf(tasks))
    expect(plan.tasks.map(task => task.id)).toEqual(['T1', 'T2'])
    expect(problems).toEqual(['teamrig served 5 planned tasks the pane cannot read, T7 (score), an entry that is no planned task, a planned task (id) and 2 more: update teamrig-pane'])
  })

  test('names the field inside a record of a task that could not be read', () => {
    expect(readOf(documentOf([planned('T5', { due: { due: '2026-03-09', at: 'soon', from: null } })])).problems).toEqual([
      'teamrig served 1 planned task the pane cannot read, T5 (due.at): update teamrig-pane',
    ])
    expect(readOf(documentOf([planned('T6', { needs: ['T3'] })])).problems).toEqual(['teamrig served 1 planned task the pane cannot read, T6 (needs[0]): update teamrig-pane'])
    expect(readOf(documentOf([planned('T6', { neededBy: [{ id: 'T9' }] })])).problems).toEqual([
      'teamrig served 1 planned task the pane cannot read, T6 (neededBy[0].owner): update teamrig-pane',
    ])
    expect(readOf(documentOf([planned('T6', { next: { kind: 'elsewhere', who: 'infra', task: 'T6', need: 'T40' } })])).problems).toEqual([
      'teamrig served 1 planned task the pane cannot read, T6 (next.team): update teamrig-pane',
    ])
    expect(readOf(documentOf([planned('T6', { next: { who: 'api', task: 'T6' } })])).problems).toEqual(['teamrig served 1 planned task the pane cannot read, T6 (next.kind): update teamrig-pane'])
  })

  test('leaves out a finished task it cannot read, in a line of its own', () => {
    const finished = [{ id: 'T2', workClass: 'Roadmap' }, { id: 'T5' }, 7]
    const { plan, problems } = readOf(documentOf([planned('T9', { band: null })], { finished }))
    expect(plan).toEqual({ at: Date.parse(AT), validUntil: null, week: null, tasks: [], finished: [{ id: 'T2', workClass: 'Roadmap' }] })
    expect(problems).toEqual([
      'teamrig served 1 planned task the pane cannot read, T9 (band): update teamrig-pane',
      'teamrig served 2 finished tasks the pane cannot read, T5 (workClass), an entry that is no finished task: update teamrig-pane',
    ])
  })

  test('is unreadable with no judging time, or a moment or week of another type', () => {
    expect(planOf(documentOf([], { at: null }))).toEqual(unreadable('cannot be read (at): update teamrig'))
    expect(planOf(documentOf([], { at: '2026-03-02 09:00' }))).toEqual(unreadable('cannot be read (at): update teamrig'))
    expect(planOf(documentOf([], { validUntil: 'tomorrow' }))).toEqual(unreadable('cannot be read (validUntil): update teamrig'))
    expect(planOf(documentOf([], { week: 9 }))).toEqual(unreadable('cannot be read (week): update teamrig'))
  })

  test('is unreadable with no task list or no finished list', () => {
    const noTasks = parseDocument({ ...planDocument('p1', []), tasks: null })
    if (noTasks.kind !== 'document') throw new Error('the fixture is no document')
    expect(planOf(noTasks.document)).toEqual(unreadable('holds no task list: update teamrig'))
    expect(planOf(documentOf([], { finished: {} }))).toEqual(unreadable('holds no finished list: update teamrig'))
  })
})
