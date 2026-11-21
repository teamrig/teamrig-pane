// The pane's tree of a snapshot (hooks/plan-tree.ts): every answer is the served plan's row, and a task the plan
// holds no row for, or every task while no plan is held, draws unranked with nothing read in the plan's place (T4759).
import { describe, expect, test } from 'claude-code/testing'
import { dueTime, readRegister, TimeZone } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { planOf, type PlanRead } from '../hooks/plan-document'
import { PlanTree, treeOf, type PlanSource } from '../hooks/plan-tree'
import { parseDocument, type JsonRecord } from '../hooks/read-document'
import type { TaskRow, TeamLeads } from '../types'
import { HOUR, NOW, createLine, statusLine } from './fixtures'
import { planDocument, planned } from './served-documents'

const DUE_AT = Date.UTC(2026, 9, 20, 9, 0)
const NEEDER_DUE = { due: '2026-10-20 09:00', at: new Date(DUE_AT).toISOString(), from: null }

/** api's five tasks, T3 finished; T1 holds its own date. */
const TASKS: readonly TaskRow[] = [
  ...readRegister(
    [
      createLine('T1', { owner: 'api', by: 'lead', at: NOW - 3 * HOUR, due: '2026-10-22' }),
      createLine('T2', { owner: 'api', by: 'lead', at: NOW - 3 * HOUR }),
      createLine('T3', { owner: 'api', by: 'lead', at: NOW - 3 * HOUR }),
      statusLine('T3', 'api', NOW - HOUR, 'done'),
      createLine('T4', { owner: 'api', by: 'lead', at: NOW - 3 * HOUR }),
      createLine('T10', { owner: 'api', by: 'lead', at: NOW - 3 * HOUR }),
    ].join('\n'),
  ).state.tasks.values(),
].map(task => rowOf(task))

function taskOf(id: string): TaskRow {
  const task = TASKS.find(row => row.id === id)
  if (task === undefined) throw new Error(`no task ${id}`)
  return task
}

/** The plan document of `rows` as the pane's own readers take it. */
function planRead(rows: readonly JsonRecord[], over: JsonRecord = {}): PlanRead {
  const read = parseDocument(planDocument('r1', rows, over))
  if (read.kind !== 'document') throw new Error(`no document: ${read.kind}`)
  const plan = planOf(read.document)
  if (plan.kind !== 'read') throw new Error(plan.reason)
  return plan.value
}

function sourceOf(plan: PlanRead | null, leads: TeamLeads | null = null): PlanSource {
  return { tasks: TASKS, plan, now: NOW, notPickedUpAfterHours: 4, timeZone: TimeZone.UTC.name, leads }
}

/**
 * teamrig placed T2 first, working to the date of ui's T7 that needs it, then T1, parked, with no date of its own
 * left; T2 needs a task of another team that is verifying and one whose status this pane does not know.
 */
const PLAN = planRead(
  [
    planned('T2', {
      score: 36.67,
      workClass: 'Roadmap',
      due: { ...NEEDER_DUE, from: 'T7' },
      needs: [
        { id: 'T90', team: 'ops', owner: 'infra', status: 'verifying' },
        { id: 'T91', team: 'ops', owner: 'infra', status: 'paused' },
        { id: 'T3', team: null, owner: 'api', status: 'in-progress' },
      ],
      neededBy: [{ id: 'T7', owner: 'ui', due: NEEDER_DUE }, { id: 'T8', owner: 'web', due: null }],
    }),
    planned('T1', { parked: true, due: null }),
  ],
  { finished: [{ id: 'T3', workClass: 'Maintenance' }] },
)

const ids = (tree: PlanTree) => [...TASKS].sort((a, b) => tree.byPlanOrder(a, b)).map(task => task.id)

describe('a tree of the served plan', () => {
  const tree = treeOf(sourceOf(PLAN))

  test("orders tasks by the plan's places, then the ones it holds no row for by number", () => {
    expect(ids(tree)).toEqual(['T2', 'T1', 'T3', 'T4', 'T10'])
    expect(tree.byPlanOrder(taskOf('T4'), taskOf('T1'))).toBe(1)
    expect(tree.byPlanOrder(taskOf('T1'), taskOf('T4'))).toBe(-1)
  })

  test('parks the task the plan parked, and no other', () => {
    expect(TASKS.filter(task => tree.isParked(task)).map(task => task.id)).toEqual(['T1'])
  })

  test("ranks an active task by its row, a finished one by its class alone, and one the plan lacks not at all", () => {
    expect(tree.rankedOf(taskOf('T2'))).toEqual({ workClass: 'Roadmap', score: 36.67 })
    expect(tree.rankedOf(taskOf('T3'))).toEqual({ workClass: 'Maintenance', score: null })
    expect(tree.rankedOf(taskOf('T4'))).toBeUndefined()
  })

  test("works a placed task to the plan's date, never its own: the needer's, or none", () => {
    expect(tree.effectiveDue(taskOf('T2'))).toEqual({ due: '2026-10-20 09:00', at: DUE_AT, from: 'T7' })
    expect(tree.dueTime(taskOf('T2'))).toBe(DUE_AT)
    // T1 holds 2026-10-22 in the register, and the plan says it works to no date: the plan wins.
    expect(tree.effectiveDue(taskOf('T1'))).toBeUndefined()
    expect(tree.dueTime(taskOf('T1'))).toBeUndefined()
  })

  test('works a task the plan lacks to its own date, none when it has none or one that cannot be read', () => {
    const own = { ...taskOf('T10'), due: '2026-10-22' }
    const at = dueTime({ due: '2026-10-22' }, TimeZone.UTC)
    expect(at === undefined).toBe(false)
    expect(tree.effectiveDue(own)).toEqual({ due: '2026-10-22', at, from: null })
    expect(tree.effectiveDue(taskOf('T10'))).toBeUndefined()
    // teamrig's reader folds no such due; a row holding one all the same works to no date.
    expect(tree.effectiveDue({ ...taskOf('T4'), due: 'someday' })).toBeUndefined()
  })

  test('names who needs a task as the plan lists them, no one for a task with no row', () => {
    expect(tree.neededByOthers('T2')).toEqual([
      { id: 'T7', owner: 'ui', due: { due: '2026-10-20 09:00', at: DUE_AT, from: null } },
      { id: 'T8', owner: 'web', due: null },
    ])
    expect(tree.neededByOthers('T1')).toEqual([])
    expect(tree.neededByOthers('T4')).toEqual([])
  })

  test("reads a status from the snapshot's own task first, then from the need the plan names, and none it does not know", () => {
    const { statusOf } = tree.context
    // The snapshot holds T3 done; the plan's need still says in-progress: the snapshot is the newer read of its own task.
    expect([statusOf('T2'), statusOf('T3')]).toEqual(['open', 'done'])
    expect(statusOf('T90')).toBe('verifying')
    expect(statusOf('T91')).toBeUndefined()
    expect(statusOf('T404')).toBeUndefined()
  })

  test("carries the snapshot's clock and zone, the team's NOT PICKED UP hours and its leads", () => {
    const leads: TeamLeads = { lead: 'lead', leaderOf: { api: 'lead' } }
    const led = new PlanTree(sourceOf(PLAN, leads))
    expect([led.context.now, led.context.zone.name, led.notPickedUpMs, led.leads]).toEqual([NOW, TimeZone.UTC.name, 4 * HOUR, leads])
    expect(tree.leads).toBeNull()
  })
})

describe('a tree with no plan held', () => {
  // A teamrig older than interface 1.1, or a failed read: nothing is folded from the register's files in its place.
  const tree = treeOf(sourceOf(null))

  test('lists every task by number, unranked, with nothing parked', () => {
    expect(ids(tree)).toEqual(['T1', 'T2', 'T3', 'T4', 'T10'])
    expect(TASKS.map(task => tree.rankedOf(task))).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect(TASKS.some(task => tree.isParked(task))).toBe(false)
  })

  test('works each task to its own date and names no needer', () => {
    expect(tree.effectiveDue(taskOf('T1'))).toEqual({ due: '2026-10-22', at: dueTime({ due: '2026-10-22' }, TimeZone.UTC), from: null })
    expect(tree.effectiveDue(taskOf('T2'))).toBeUndefined()
    expect(tree.neededByOthers('T2')).toEqual([])
  })

  test('knows the status of its own tasks alone', () => {
    expect([tree.context.statusOf('T3'), tree.context.statusOf('T90')]).toEqual(['done', undefined])
  })
})
