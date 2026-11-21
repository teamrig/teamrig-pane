// The `plan` document as the fake teamrig serves it (tests/fake-read.ts): the body interface 1.1 builds in teamrig's
// src/interface/plan.ts, field for field, from the pane's fold of the register and the tree the pane itself reads
// that fold with (hooks/meta.ts), so a whole-pane spec's plan says what the pane's own tree says of the same files.
// It serves every session's tasks (the pane passes no `--owner`) and leaves out `at`, the clock, which the fake adds
// after it has taken the revision: teamrig's revision covers the files and never the clock.
import { MS_PER_DAY, parseDeadline } from '../hooks/core/core/time'
import { ACTIVE_STATUSES, taskNumber, type NextMove } from '../hooks/core/read/index'
import { planBand, type PlanPlace } from '../hooks/core/register/tree'
import { treeOf, type PaneTree } from '../hooks/meta'
import type { JsonRecord } from '../hooks/read-document'
import type { Snapshot, TaskRow } from '../types'

/** The settings whose days turn an answer of the plan with no file moving (`focus.score.dueSoonDays`, `focus.parkAfterDays`). */
type PlanTurns = { readonly dueSoonDays: number; readonly parkAfterDays: number }

function isActive(task: TaskRow): boolean {
  return ACTIVE_STATUSES.includes(task.status)
}

/** A plan is a ranked read: the pane's tree is always built with its ranking, so a place with none is a bug here. */
function rankedOf(place: PlanPlace): NonNullable<PlanPlace['ranked']> {
  if (place.ranked === undefined) throw new Error('the plan document needs a tree built with its ranking')
  return place.ranked
}

function servedDue(id: string, tree: PaneTree): JsonRecord | null {
  const due = tree.effectiveDue(id)
  return due === undefined ? null : { due: due.due, at: new Date(due.at).toISOString(), from: due.from }
}

function servedNeed(id: string, tree: PaneTree): JsonRecord {
  const own = tree.task(id)
  if (own !== undefined) return { id, team: null, owner: own.owner, status: own.status }
  const away = tree.elsewhereOf(id)
  return away === undefined ? { id, team: null, owner: null, status: null } : { id, team: away.team, owner: away.task.owner, status: away.task.status }
}

function servedMove(move: NextMove<TaskRow>, tree: PaneTree): JsonRecord {
  switch (move.kind) {
    case 'elsewhere':
      return { kind: 'elsewhere', who: move.who, task: move.task.id, team: move.team, need: move.need.id }
    case 'time':
      return { kind: 'time', who: move.who, task: move.task.id, behind: move.behind?.id ?? null, at: parseDeadline(move.at, tree.zone)?.toISOString() ?? move.at }
    default:
      return { kind: move.kind, who: move.who, task: move.task.id, behind: move.behind?.id ?? null }
  }
}

function plannedTask(task: TaskRow, tree: PaneTree): JsonRecord {
  const place = tree.placeOf(task)
  const ranked = rankedOf(place)
  const move = tree.nextMove(task.id)
  return {
    id: task.id,
    parked: tree.isParked(task),
    pinned: place.pinned === true,
    band: planBand(ranked),
    ready: place.blocked !== true,
    score: ranked.score,
    started: place.started === true,
    due: servedDue(task.id, tree),
    unblocks: place.unblocks === undefined ? null : { first: place.unblocks.first, priority: place.unblocks.priority, count: place.unblocks.count },
    inWeek: place.inWeek === true,
    size: task.size,
    costOfDelay: ranked.costOfDelay,
    sizePct: ranked.sizePct,
    workClass: ranked.workClass,
    goal: ranked.goal === null ? null : { tag: ranked.goal.tag, rank: ranked.goal.rank },
    prep: ranked.prep,
    needs: tree.needs(task.id).map(id => servedNeed(id, tree)),
    neededBy: tree.neededByOthers(task.id).map(needer => ({ id: needer.id, owner: needer.owner, due: servedDue(needer.id, tree) })),
    next: move === undefined ? null : servedMove(move, tree),
  }
}

/**
 * The moments one task's answers may turn at with no file moving: its effective due and the day that due comes near,
 * each time it waits until, and for an open task the day the park rule may take it.
 */
function turnsOf(task: TaskRow, tree: PaneTree, turns: PlanTurns): number[] {
  const due = tree.dueTime(task)
  const waits = task.waits.flatMap(reason => (reason.kind === 'time' ? [parseDeadline(reason.at, tree.zone)?.getTime() ?? Number.NaN] : []))
  const park = task.status === 'open' ? [Date.parse(task.updatedAt) + turns.parkAfterDays * MS_PER_DAY] : []
  return [...(due === undefined ? [] : [due, due - turns.dueSoonDays * MS_PER_DAY]), ...waits, ...park].filter(at => Number.isFinite(at))
}

/**
 * The `plan` document's body for the fold's register at the fold's clock, without `at`: the active tasks in plan
 * order, each as the tree places it, then the finished ones the fold still holds, by number, with their work class.
 */
export function servedPlan(fold: Snapshot): JsonRecord {
  const tree = treeOf(fold)
  const turns = { dueSoonDays: fold.focus.score.dueSoonDays, parkAfterDays: fold.focus.parkAfterDays }
  const active = tree.inPlanOrder(fold.tasks.filter(isActive))
  const ahead = active.flatMap(task => turnsOf(task, tree, turns)).filter(at => at > fold.now)
  return {
    validUntil: ahead.length === 0 ? null : new Date(Math.min(...ahead)).toISOString(),
    week: tree.week,
    tasks: active.map(task => plannedTask(task, tree)),
    finished: fold.tasks
      .filter(task => !isActive(task))
      .sort((a, b) => taskNumber(a.id) - taskNumber(b.id))
      .map(task => ({ id: task.id, workClass: rankedOf(tree.placeOf(task)).workClass })),
  }
}
