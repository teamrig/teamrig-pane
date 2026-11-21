// The team's plan from teamrig's `plan` document (T4759, interface 1.1): where teamrig's own tree places each active
// task, read field by field, so the pane ranks, parks and dates nothing itself. The document serves the active tasks
// in plan order, the place in the list being the rank, each with the keys of that order (so tasks of several teams
// sort together as teamrig sorts them), what its score was read from, the tasks it needs and the ones that need it,
// and who moves first so it can finish; beside them the finished tasks the register still holds, each with the work
// class its rank is shown with. It names tasks by id alone: a reader joins them to the `tasks` document's rows. The
// order served is kept. A planned or finished task with a field of another type is left out and the left-out ones
// are told in one line, rather than a task drawn at a place teamrig did not give it; a move of a kind this pane does
// not know reads as unknown, as the interface says a reader may pass one over. `validUntil` is the first moment an
// answer here may change with no file moving: teamrig's revision covers files and never the clock, so past it the
// caller asks again with no revision held. An `unchanged` answer holds no plan, so it is never handed here. Pure.
import { Fields, isList, leftOutLine, momentOf, type BodyRead } from './document-fields'
import { isRecord, type ReadDocument } from './read-document'

/** The date a task works to: its own due, or the earlier one of a task that needs it. */
export type PlanDue = {
  /** As stored: a day of the team's zone, or a day and time in UTC. */
  readonly due: string
  /** The same moment, in milliseconds. */
  readonly at: number
  /** The needing task whose due this is; null when it is the task's own. */
  readonly from: string | null
}

/** The best of the active tasks that need a task, and how many need it. */
export type PlanUnblocks = { readonly first: string; readonly priority: number; readonly count: number }

/** The ranked goal a task's score was read from. */
export type PlanGoal = { readonly tag: string; readonly rank: number }

/**
 * A task another one is planned after or waits on. `team` is null for a task of the same register; `owner` and
 * `status` are null for an id no register of the tree holds any more, which was retired, so finished.
 */
export type PlanNeed = { readonly id: string; readonly team: string | null; readonly owner: string | null; readonly status: string | null }

/** An active task of another session, in the same register, that needs a task. */
export type PlanNeeder = { readonly id: string; readonly owner: string; readonly due: PlanDue | null }

/**
 * Who moves first so a task can finish, on which task: its owner's work, a decision or an approval asked of `who`,
 * the owner again once `at` has come (null for a stored time teamrig could not read as a moment), or the owner of
 * `need`, an unfinished task `team`'s register holds. `behind` is an in-progress task of the same session it works
 * first. `unknown` is a move of a kind a later minor added.
 */
export type PlanMove =
  | { readonly kind: 'work' | 'decision' | 'approval'; readonly who: string; readonly task: string; readonly behind: string | null }
  | { readonly kind: 'time'; readonly who: string; readonly task: string; readonly behind: string | null; readonly at: number | null }
  | { readonly kind: 'elsewhere'; readonly who: string; readonly task: string; readonly team: string; readonly need: string }
  | { readonly kind: 'unknown' }

/** One active task as the team's plan places it. */
export type PlannedTask = {
  readonly id: string
  /** The park rule takes it out of the lists. */
  readonly parked: boolean
  readonly pinned: boolean
  /** 0 is expedite, 1 near-term prep, then the team's class bands; the lowest first. */
  readonly band: number
  /** No wait of it is pending and every task it is planned after is finished. */
  readonly ready: boolean
  /** Cost of delay over size; the highest first. */
  readonly score: number
  readonly started: boolean
  readonly due: PlanDue | null
  readonly unblocks: PlanUnblocks | null
  /** Tagged with the week plan in force. */
  readonly inWeek: boolean
  /** Its size in percent of the weekly limit; null when not sized. */
  readonly size: number | null
  readonly costOfDelay: number
  /** The work left the score divides by, in percent of the weekly limit. */
  readonly sizePct: number
  readonly workClass: string
  readonly goal: PlanGoal | null
  readonly prep: boolean
  readonly needs: readonly PlanNeed[]
  /** The one with the earliest date first, then in plan order. */
  readonly neededBy: readonly PlanNeeder[]
  /** Null when every unfinished need of it runs into a loop. */
  readonly next: PlanMove | null
}

/** A finished task and the work class its rank is shown with. */
export type FinishedTask = { readonly id: string; readonly workClass: string }

/** What the `plan` document says. */
export type PlanRead = {
  /** When teamrig judged the plan, in milliseconds. */
  readonly at: number
  /** The first moment after `at` an answer may change with no file moving; null with none ahead. */
  readonly validUntil: number | null
  /** The week plan in force; null with none. */
  readonly week: string | null
  /** The active tasks in plan order: the place in this list is the rank. */
  readonly tasks: readonly PlannedTask[]
  /** The finished tasks the register still holds, in the order served. */
  readonly finished: readonly FinishedTask[]
}

function dueOf(due: Fields | null): PlanDue | null {
  return due === null ? null : { due: due.text('due'), at: due.moment('at'), from: due.textOrNull('from') }
}

function unblocksOf(unblocks: Fields | null): PlanUnblocks | null {
  return unblocks === null ? null : { first: unblocks.text('first'), priority: unblocks.number('priority'), count: unblocks.number('count') }
}

function goalOf(goal: Fields | null): PlanGoal | null {
  return goal === null ? null : { tag: goal.text('tag'), rank: goal.number('rank') }
}

function needOf(need: Fields): PlanNeed {
  return { id: need.text('id'), team: need.textOrNull('team'), owner: need.textOrNull('owner'), status: need.textOrNull('status') }
}

function neederOf(needer: Fields): PlanNeeder {
  return { id: needer.text('id'), owner: needer.text('owner'), due: dueOf(needer.partOrNull('due')) }
}

function moveOf(move: Fields | null): PlanMove | null {
  if (move === null) return null
  const kind = move.text('kind')
  switch (kind) {
    case 'work':
    case 'decision':
    case 'approval':
      return { kind, who: move.text('who'), task: move.text('task'), behind: move.textOrNull('behind') }
    case 'time':
      // teamrig serves the stored text where it could not read a moment from it: the move still stands, with no time.
      return { kind, who: move.text('who'), task: move.text('task'), behind: move.textOrNull('behind'), at: momentOf(move.text('at')) }
    case 'elsewhere':
      return { kind, who: move.text('who'), task: move.text('task'), team: move.text('team'), need: move.text('need') }
    default:
      return { kind: 'unknown' }
  }
}

function plannedOf(task: Fields): PlannedTask {
  return {
    id: task.text('id'),
    parked: task.flag('parked'),
    pinned: task.flag('pinned'),
    band: task.number('band'),
    ready: task.flag('ready'),
    score: task.number('score'),
    started: task.flag('started'),
    due: dueOf(task.partOrNull('due')),
    unblocks: unblocksOf(task.partOrNull('unblocks')),
    inWeek: task.flag('inWeek'),
    size: task.numberOrNull('size'),
    costOfDelay: task.number('costOfDelay'),
    sizePct: task.number('sizePct'),
    workClass: task.text('workClass'),
    goal: goalOf(task.partOrNull('goal')),
    prep: task.flag('prep'),
    needs: task.parts('needs').map(needOf),
    neededBy: task.parts('neededBy').map(neederOf),
    next: moveOf(task.partOrNull('next')),
  }
}

function finishedOf(task: Fields): FinishedTask {
  return { id: task.text('id'), workClass: task.text('workClass') }
}

/** The entries of one served list that could be read, in its order, and which were left out with the first field that could not be. */
type ListRead<T> = { readonly values: T[]; readonly left: string[] }

/** Reads each entry of `served` with `read`; `what` names an entry whose id could not be read. */
function listOf<T extends { readonly id: string }>(served: readonly unknown[], what: string, read: (entry: Fields) => T): ListRead<T> {
  const values: T[] = []
  const left: string[] = []
  for (const entry of served) {
    if (!isRecord(entry)) {
      left.push(`an entry that is no ${what}`)
      continue
    }
    const fields = new Fields(entry)
    const value = read(fields)
    const bad = fields.bad
    const [first] = bad
    if (first === undefined) values.push(value)
    else left.push(`${bad.includes('id') ? `a ${what}` : value.id} (${first})`)
  }
  return { values, left }
}

function unreadable(why: string): BodyRead<PlanRead> {
  return { kind: 'unreadable', reason: `teamrig's plan document ${why}` }
}

/**
 * What `document` says of the team's plan, with the tasks left out told in a line for each list; unreadable with no
 * judging time, task list or finished list, which every `plan` document of this major holds.
 */
export function planOf(document: ReadDocument): BodyRead<PlanRead> {
  const head = new Fields(document.fields)
  const at = head.moment('at')
  const validUntil = head.momentOrNull('validUntil')
  const week = head.textOrNull('week')
  const [missing] = head.bad
  if (missing !== undefined) return unreadable(`cannot be read (${missing}): update teamrig`)
  const servedTasks = document.fields['tasks']
  if (!isList(servedTasks)) return unreadable('holds no task list: update teamrig')
  const servedFinished = document.fields['finished']
  if (!isList(servedFinished)) return unreadable('holds no finished list: update teamrig')
  const tasks = listOf(servedTasks, 'planned task', plannedOf)
  const finished = listOf(servedFinished, 'finished task', finishedOf)
  return {
    kind: 'read',
    value: { at, validUntil, week, tasks: tasks.values, finished: finished.values },
    problems: [
      ...(tasks.left.length === 0 ? [] : [leftOutLine('planned task', tasks.left)]),
      ...(finished.left.length === 0 ? [] : [leftOutLine('finished task', finished.left)]),
    ],
  }
}
