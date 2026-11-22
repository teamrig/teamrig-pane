// The Stats tab's numbers from teamrig's `stats` document (hooks/stats-document.ts): every field reads into the shape
// the tab draws; a count's, a goal's and an area cell's ids join back to their slim rows in the order served; a task
// row the pane cannot read is left out and told in one line, the counts kept; a level or goal state a later minor adds
// reads as the nearest the pane draws; any other field missing makes the document unreadable; whether an area stands
// out is teamrig's own rule (T4759).
import { describe, expect, test } from 'claude-code/testing'
import { parseDocument, type JsonRecord, type ReadDocument } from '../hooks/read-document'
import { areaListKey } from '../hooks/stats-areas'
import { statsOf, type StatsRead } from '../hooks/stats-document'
import type { StatsListRow } from '../types'
import { HOUR, NOW } from './fixtures'
import { areaCell, statsArea, statsDocument, statsTask } from './served-documents'

const ZERO_MEDIAN = { bugs: 0, p1: 0, p1Late: 0, low: 0, waits: 0, active: 0 }

function documentOf(over: JsonRecord = {}): ReadDocument {
  const read = parseDocument(statsDocument('s1', over))
  if (read.kind !== 'document') throw new Error(`the fixture is no document: ${read.kind}`)
  return read.document
}

/** What the reader makes of a document; fails the test on one it could not read at all. */
function readOf(document: ReadDocument): { stats: StatsRead; problems: readonly string[] } {
  const read = statsOf(document, 'shop')
  if (read.kind !== 'read') throw new Error(read.reason)
  return { stats: read.value, problems: read.problems }
}

function row(id: string, over: Partial<StatsListRow> = {}): StatsListRow {
  return { team: 'shop', id, title: `Title of ${id}`, owner: 'api', status: 'open', priority: 2, due: null, ...over }
}

function unreadable(why: string): { kind: 'unreadable'; reason: string } {
  return { kind: 'unreadable', reason: `teamrig's stats document ${why}` }
}

const ALL = { active: 1, leadTime: { count: 0, median: null, p85: null }, cycleTime: { count: 0, median: null, p85: null }, overdue: { count: 0, p1: 0 }, due: { total: 0, onTime: 0 } }

describe('statsOf', () => {
  test('reads every field into the numbers the tab draws, the one team counted as its own part', () => {
    const zeroActive = { open: 0, 'in-progress': 0, verifying: 0, waiting: 0 }
    expect(readOf(documentOf())).toEqual({
      stats: {
        at: NOW,
        validUntil: NOW + HOUR,
        session: null,
        stats: {
          range: '30d',
          days: [{ day: '2026-03-02', opened: 1, done: 0, dropped: 0, active: { ...zeroActive, open: 1 }, atLimit: false }],
          opened: 1,
          closedTasks: 0,
          droppedTasks: 0,
          net: 1,
          closes: 0,
          recent: { days: 14, net: 1 },
          active: { ...zeroActive, open: 1 },
          all: ALL,
          teams: [{ team: 'shop', ...ALL }],
          newWork: { total: 1, bySource: { self: 0, owner: 0, lead: 1, github: 0, session: 0 }, bugs: 0, byPriority: [{ priority: 2, count: 1 }], byGoal: [], noGoal: 1 },
          activeByAge: [{ label: '0-1 d', count: 1 }],
          neverStarted: 0,
          lateDays: [],
          dueMoved: 0,
          waits: { waiting: 0, byKind: { decision: 0, approval: 0, task: 0, time: 0 }, ownerDecisions: { count: 0, oldestDays: null } },
          bugs: { active: 0, opened: 0, fixed: 0 },
          people: [],
          splits: [],
          goals: { today: '2026-03-02', offGoal: 0, doneInRange: 0, goals: [] },
          areas: { teams: { median: ZERO_MEDIAN, areas: [] }, sessions: { median: ZERO_MEDIAN, areas: [] } },
        },
        health: {
          closeOpen: { level: 'warn', ratio: 0 },
          backlog: { level: 'good', net: 1, active: 1 },
          overdue: { level: 'good', count: 0, p1: 0 },
          ownerDecisions: { level: 'good', count: 0, oldestDays: null },
          backlogClears: { level: 'good', weeks: null },
        },
        lists: { active: [row('T1')], opened: [row('T1')], closed: [], overdue: [], overdueP1: [], ownerDecisions: [] },
        areaLists: new Map(),
      },
      problems: [],
    })
  })

  test('joins each count to its tasks in the order served, whatever the rows say', () => {
    const tasks = [statsTask('T1'), statsTask('T2', { owner: 'web', status: 'in-progress', priority: 1, due: '2026-03-01' }), statsTask('T3', { status: 'done' })]
    const behind = { active: ['T2', 'T1'], opened: ['T1'], closed: ['T3'], overdue: ['T2'], overdueP1: ['T2'], ownerDecisions: [] }
    const { stats } = readOf(documentOf({ tasks, behind }))
    const late = row('T2', { owner: 'web', status: 'in-progress', priority: 1, due: '2026-03-01' })
    expect(stats.lists).toEqual({ active: [late, row('T1')], opened: [row('T1')], closed: [row('T3', { status: 'done' })], overdue: [late], overdueP1: [late], ownerDecisions: [] })
  })

  test("reads a goal with its slips and done days, its rows with a dropped task left out, and today as the fold's last day", () => {
    const served = {
      tag: 'G1',
      title: 'Ship the tab',
      start: '2026-02-20',
      target: '2026-03-10',
      parent: null,
      slips: [{ at: '2026-02-25', by: 'lead', from: '2026-03-05', to: '2026-03-10', note: 'scope' }],
      done: 1,
      open: 1,
      doneDays: [{ day: '2026-03-01', done: 1 }],
      pace: 0.5,
      forecast: '2026-03-04',
      state: 'on track',
    }
    const tasks = [statsTask('T1'), statsTask('T3', { status: 'done' }), statsTask('T4', { status: 'dropped' })]
    const { stats } = readOf(documentOf({ tasks, goals: { goals: [{ ...served, tasks: ['T3', 'T4', 'T1'] }], offGoal: 2, doneInRange: 3 } }))
    expect(stats.stats.goals).toEqual({
      today: '2026-03-02',
      offGoal: 2,
      doneInRange: 3,
      goals: [{ ...served, rows: [row('T3', { status: 'done' }), row('T1')] }],
    })
  })

  test("takes today from the counting moment's UTC day when the fold counted no day", () => {
    expect(readOf(documentOf({ days: [] })).stats.stats.goals.today).toBe(new Date(NOW).toISOString().slice(0, 10))
  })

  test('reads a level or a goal state a later minor adds as the nearest the pane draws', () => {
    const goal = { tag: 'G1', title: 'Ship', start: '2026-02-20', target: '2026-03-10', parent: null, slips: [], done: 0, open: 0, doneDays: [], pace: 0, forecast: null, state: 'stalled', tasks: [] }
    const health = {
      closeOpen: { level: 'warn', ratio: 0 },
      backlog: { level: 'good', net: 1, active: 1 },
      overdue: { level: 'grave', count: 0, p1: 0 },
      ownerDecisions: { level: 'good', count: 0, oldestDays: null },
      backlogClears: { level: 'good', weeks: null },
    }
    const { stats, problems } = readOf(documentOf({ goals: { goals: [goal], offGoal: 0, doneInRange: 0 }, health }))
    expect(stats.health.overdue.level).toBe('warn')
    expect(stats.stats.goals.goals[0]?.state).toBe('at risk')
    expect(problems).toEqual([])
  })

  test('sets each area cell its rows under its key, and marks a lone area by an amber cell, as teamrig does', () => {
    const sessions = { areas: [statsArea('api', { p1: areaCell(['T2'], { level: 'warn' }) })], median: ZERO_MEDIAN }
    const tasks = [statsTask('T1'), statsTask('T2', { priority: 1 })]
    const { stats } = readOf(documentOf({ tasks, areas: { teams: { areas: [], median: ZERO_MEDIAN }, sessions } }))
    const [api] = stats.stats.areas.sessions.areas
    expect(api?.standsOut).toBe(true)
    expect(api?.cells.p1).toEqual({ value: 1, usual: 1, level: 'warn', listed: 1 })
    expect(stats.areaLists.get(areaListKey({ team: 'shop', session: 'api', measure: 'p1' }))).toEqual([row('T2', { priority: 1 })])
    expect(stats.areaLists.get(areaListKey({ team: 'shop', session: 'api', measure: 'bugs' }))).toEqual([])
  })

  test('marks an area among others only by a red cell', () => {
    const areas = [statsArea('api', { bugs: areaCell([], { level: 'bad' }) }), statsArea('web', { p1: areaCell([], { level: 'warn' }) })]
    const { stats } = readOf(documentOf({ areas: { teams: { areas: [], median: ZERO_MEDIAN }, sessions: { areas, median: ZERO_MEDIAN } } }))
    expect(stats.stats.areas.sessions.areas.map(area => [area.session, area.standsOut])).toEqual([
      ['api', true],
      ['web', false],
    ])
  })

  test('leaves out a task row it cannot read and tells it in one line, the counts kept as teamrig counted them', () => {
    const tasks = [statsTask('T1'), statsTask('T2', { status: 'paused' }), statsTask('T3', { priority: 'high' })]
    const behind = { active: ['T1', 'T2', 'T3'], opened: [], closed: [], overdue: [], overdueP1: [], ownerDecisions: [] }
    const { stats, problems } = readOf(documentOf({ tasks, behind, opened: 3 }))
    expect(stats.lists.active).toEqual([row('T1')])
    expect(stats.stats.opened).toBe(3)
    expect(problems).toEqual(['teamrig served 2 stats tasks the pane cannot read, T2 (status "paused"), T3 (priority): update teamrig-pane'])
  })

  test('reads the session the numbers were narrowed to', () => {
    expect(readOf(documentOf({ session: 'api' })).stats.session).toBe('api')
  })

  test('is unreadable with any field other than a task row missing or of another type', () => {
    expect(statsOf(documentOf({ at: null }), 'shop')).toEqual(unreadable('cannot be read (at): update teamrig'))
    expect(statsOf(documentOf({ opened: '1' }), 'shop')).toEqual(unreadable('cannot be read (opened): update teamrig'))
    expect(statsOf(documentOf({ range: 'fortnight' }), 'shop')).toEqual(unreadable('cannot be read (range "fortnight"): update teamrig'))
    expect(statsOf(documentOf({ behind: null }), 'shop')).toEqual(unreadable('cannot be read (behind): update teamrig'))
  })

  test('is unreadable with no task list', () => {
    expect(statsOf(documentOf({ tasks: null }), 'shop')).toEqual(unreadable('holds no task list: update teamrig'))
  })
})
