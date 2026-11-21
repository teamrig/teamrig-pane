// The snapshot's tasks as teamrig's plan places them (T4759): every answer the lists, the meta line and the card ask
// of the dependency tree, read from the `plan` document's rows (plan-document.ts) and never worked out here, so the
// pane ranks, parks and dates a task exactly as `teamrig list` does. A task the plan holds no row for (a finished
// one, one added since the plan was read, every one while no plan is held: a teamrig older than interface 1.1, a
// failed read) is not parked, holds no rank, works to its own due and lists after the placed ones by number; nothing
// is read from the register's files in its place. Pure.
import type { TaskRow, TaskStatus, TeamLeads } from '../types'
import { dueTime, isTaskStatus, taskNumber, type WaitContext } from './core/read/index'
import type { PlanDue, PlannedTask, PlanNeeder, PlanRead } from './plan-document'
import { zoneNamed } from './zone'

const HOUR_MS = 3_600_000

/**
 * What treeOf reads from a snapshot (types/index.d.ts Snapshot): its tasks, the plan teamrig served for them (null
 * with none held), its clock, the team's NOT PICKED UP hours and zone, and who leads whom.
 */
export type PlanSource = {
  readonly tasks: readonly TaskRow[]
  readonly plan: PlanRead | null
  readonly now: number
  readonly notPickedUpAfterHours: number
  readonly timeZone: string
  readonly leads: TeamLeads | null
}

/** A task's work class, and its score while it is active: a finished task holds no place in the order. */
export type Ranked = { readonly workClass: string; readonly score: number | null }

export class PlanTree {
  /**
   * The clock in the team's zone, and the status of a task by id: a snapshot task's own, else the one the plan names
   * it with where a planned task needs it (a task of another register, or one finished before the snapshot's days).
   * Undefined reads as finished, as in teamrig: an id no register holds any more, and a status this pane does not know.
   */
  readonly context: WaitContext
  /** How long a task may stand untouched by its owner before it reads NOT PICKED UP (`register.check.notPickedUpAfterHours`). */
  readonly notPickedUpMs: number
  /** Who leads whom, for the card's Lead row (leads.ts). */
  readonly leads: TeamLeads | null
  private readonly rows: ReadonlyMap<string, PlannedTask>
  private readonly places: ReadonlyMap<string, number>
  private readonly finished: ReadonlyMap<string, string>

  constructor(source: PlanSource) {
    const planned = source.plan?.tasks ?? []
    this.rows = new Map(planned.map(row => [row.id, row]))
    this.places = new Map(planned.map((row, place) => [row.id, place]))
    this.finished = new Map((source.plan?.finished ?? []).map(task => [task.id, task.workClass]))
    this.notPickedUpMs = source.notPickedUpAfterHours * HOUR_MS
    this.leads = source.leads
    const own = new Map(source.tasks.map(task => [task.id, task.status]))
    const needed = new Map(planned.flatMap(row => row.needs.map(need => [need.id, need.status] as const)))
    this.context = {
      now: source.now,
      zone: zoneNamed(source.timeZone),
      statusOf: (id: string): TaskStatus | undefined => {
        const status = own.get(id) ?? needed.get(id)
        return isTaskStatus(status) ? status : undefined
      },
    }
  }

  /** Whether the park rule takes the task out of the lists. */
  isParked(task: TaskRow): boolean {
    return this.rows.get(task.id)?.parked ?? false
  }

  /**
   * The date the task works to: the plan's effective due (its own, or the earlier one of a task that needs it); a
   * task with no row keeps its own, undefined with none or one that cannot be read.
   */
  effectiveDue(task: TaskRow): PlanDue | undefined {
    const row = this.rows.get(task.id)
    if (row !== undefined) return row.due ?? undefined
    if (task.due === null) return undefined
    const at = dueTime({ due: task.due }, this.context.zone)
    return at === undefined ? undefined : { due: task.due, at, from: null }
  }

  /** The moment of effectiveDue. */
  dueTime(task: TaskRow): number | undefined {
    return this.effectiveDue(task)?.at
  }

  /** teamrig's plan order: the place the plan serves a task at; one with no row after every placed one, by number. */
  byPlanOrder(a: TaskRow, b: TaskRow): number {
    const [placeA, placeB] = [this.places.get(a.id), this.places.get(b.id)]
    if (placeA !== undefined && placeB !== undefined) return placeA - placeB
    if (placeA !== undefined) return -1
    if (placeB !== undefined) return 1
    return taskNumber(a.id) - taskNumber(b.id)
  }

  /** What the task's rank is shown with; undefined for a task the plan does not hold. */
  rankedOf(task: TaskRow): Ranked | undefined {
    const row = this.rows.get(task.id)
    if (row !== undefined) return { workClass: row.workClass, score: row.score }
    const workClass = this.finished.get(task.id)
    return workClass === undefined ? undefined : { workClass, score: null }
  }

  /** The active tasks of other sessions that need the task, the one with the earliest date first. */
  neededByOthers(id: string): readonly PlanNeeder[] {
    return this.rows.get(id)?.neededBy ?? []
  }
}

/** The snapshot's tasks as the plan it carries places them, at its clock in the team's zone. */
export function treeOf(snap: PlanSource): PlanTree {
  return new PlanTree(snap)
}
