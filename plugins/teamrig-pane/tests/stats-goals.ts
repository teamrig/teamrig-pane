// The Stats tab's goals as a spec builds them from core's fold (register/stats.ts GoalStats): the shape the
// `stats` document reads into (hooks/stats-document.ts), each goal's active tasks p1 first, then by due date, then its
// done ones, the latest done first; a dropped task left out.
import type { StatsGoals, StatsListRow } from '../types'
import { ACTIVE_STATUSES, dueTime, planOrder, type GoalStats, type StatsTask, type TimeZone } from '../hooks/core/read/index'

function rowsOf(list: readonly StatsTask[], zone: TimeZone): StatsListRow[] {
  return list
    .map(({ team, task }) => ({
      row: { team, id: task.id, title: task.title, owner: task.owner, status: task.status, priority: task.priority, due: task.due },
      place: { id: task.id, at: dueTime(task, zone) },
    }))
    .sort((a, b) => a.row.priority - b.row.priority || planOrder(a.place, b.place))
    .map(each => each.row)
}

/** `goals` as the tab draws them, `today` the team's day they were counted on. */
export function goalsOf(goals: GoalStats, zone: TimeZone, today: string): StatsGoals {
  return {
    today,
    offGoal: goals.offGoal,
    doneInRange: goals.doneInRange,
    goals: goals.goals.map(({ tasks, ...goal }) => {
      const active = tasks.filter(({ task }) => ACTIVE_STATUSES.includes(task.status))
      const done = tasks.filter(({ task }) => task.status === 'done').sort((a, b) => Date.parse(b.task.statusAt) - Date.parse(a.task.statusAt))
      return { ...goal, rows: [...rowsOf(active, zone), ...done.flatMap(each => rowsOf([each], zone))] }
    }),
  }
}
