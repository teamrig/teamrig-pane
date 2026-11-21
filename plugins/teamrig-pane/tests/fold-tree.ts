// teamrig's own dependency tree over a fold of the register, for the specs alone: what the fake teamrig builds the
// `plan` document from (served-plan.ts), and what a spec compares the pane's drawn order and ranks against. The pane
// itself builds no such tree since T4759: it reads the plan teamrig serves (hooks/plan-tree.ts).
import { TaskTree } from '../hooks/core/read/index'
import { rankingOf } from '../hooks/ranking'
import { zoneNamed } from '../hooks/zone'
import type { GoalRanks, RankFocus, TaskElsewhere, TaskRow, TaskSpend } from '../types'

/**
 * What the tree reads of a fold (types/index.d.ts Snapshot): its tasks, the tasks of the tree's other registers a
 * need may name, its clock and zone, and what the ranking reads: the focus keys, the owner's marker, the goals' ranks
 * and what tasks have cost.
 */
export type FoldSource = {
  readonly tasks: readonly TaskRow[]
  readonly elsewhere: readonly TaskElsewhere[]
  readonly now: number
  readonly timeZone: string
  readonly focus: RankFocus
  readonly ownerSource: string
  readonly goals: GoalRanks
  readonly spend: TaskSpend
}

/** teamrig's tree of the fold's tasks at its clock in its zone, ranked as `teamrig list` ranks them. */
export function foldTreeOf(fold: FoldSource): TaskTree<TaskRow> {
  return new TaskTree(
    new Map(fold.tasks.map(task => [task.id, task])),
    new Date(fold.now),
    zoneNamed(fold.timeZone),
    undefined,
    new Map(fold.elsewhere.map(away => [away.task.id, away])),
    rankingOf(fold.focus, fold.ownerSource, fold.goals, fold.spend),
  )
}
