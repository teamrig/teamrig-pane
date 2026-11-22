// The Stats tab's numbers from teamrig's `stats` document (T4759): teamrig's stats fold of one team, or one session of
// it, read field by field into the shape the tab already draws (types/index.d.ts StatsNumbers), so the sections change
// nothing with where the numbers came from and the pane folds no register itself. The document names the tasks behind
// a count, a goal or an area cell by id, each with one slim row in `tasks`: the rows here join them back, in the order
// served, so a press lists the very tasks its count counts. A task row with a field of another type, or a status the
// pane does not know, is left out and told in one line; a count still shows what teamrig counted. A level or a goal
// state a later minor adds reads as the nearest the pane draws (`warn`, `at risk`), since a tile must draw some colour.
// Every other field is read whole or the document is unreadable: a number standing in for one teamrig did not serve
// would be drawn as if it had. One team is counted, so the fold's per-team part is that team's `all`. Whether an area
// stands out is teamrig's own rule (core standingOut), never worked out again here. Pure.
import type {
  StatsArea,
  StatsAreaCell,
  StatsAreaGroup,
  StatsGoal,
  StatsGoals,
  StatsListKind,
  StatsListRow,
  StatsNumbers,
  TaskStatus,
} from '../types'
import {
  standingOut,
  type AreaGroup,
  type AreaMeasure,
  type AreaStats,
  type GoalState,
  type HealthLevel,
  type RegisterHealth,
  type Spread,
  type StatsDay,
  type StatsRange,
  type TeamPart,
} from './core/read/index'
import { BY_ID, Fields, isList, leftOutLine, listOf, type BodyRead } from './document-fields'
import type { ReadDocument } from './read-document'
import { areaListKey, type AreaLists } from './stats-areas'
import { STATUSES } from './tasks-document'

/** Each Health count's tasks as slim rows, in the order teamrig served them. */
export type StatsLists = Readonly<Record<StatsListKind, readonly StatsListRow[]>>

/** What the `stats` document says. */
export type StatsRead = {
  /** The moment every number was counted at, in milliseconds. */
  readonly at: number
  /** The first moment a number may differ with no file moving: past it, the caller asks again with no revision held. */
  readonly validUntil: number
  /** The session the numbers were narrowed to; null for the whole team's. */
  readonly session: string | null
  readonly stats: StatsNumbers
  readonly health: RegisterHealth
  readonly lists: StatsLists
  readonly areaLists: AreaLists
}

const RANGES: Readonly<Record<StatsRange, true>> = { '7d': true, '30d': true, '90d': true, '180d': true, '1y': true, all: true }
const LEVELS: Readonly<Record<HealthLevel, true>> = { good: true, warn: true, bad: true }
const STATES: Readonly<Record<GoalState, true>> = { done: true, 'on track': true, 'at risk': true, late: true }

/** A level as the pane draws it: one a later minor adds draws as a warning, neither all clear nor the worst. */
function levelOf(fields: Fields): HealthLevel {
  const level = fields.text('level')
  return isLevel(level) ? level : 'warn'
}

function isLevel(word: string): word is HealthLevel {
  return Object.hasOwn(LEVELS, word)
}

function isState(word: string): word is GoalState {
  return Object.hasOwn(STATES, word)
}

/** A goal state as the pane draws it: one a later minor adds draws as at risk, which asks a look without alarm. */
function stateOf(fields: Fields): GoalState {
  const state = fields.text('state')
  return isState(state) ? state : 'at risk'
}

/** The slim rows of the tasks the document names, by id. */
type Rows = ReadonlyMap<string, StatsListRow>

/** The rows of `ids`, in their order; an id whose row was left out is passed over. */
function rowsOf(ids: readonly string[], rows: Rows): StatsListRow[] {
  return ids.flatMap(id => rows.get(id) ?? [])
}

function rowOf(team: string): (task: Fields) => StatsListRow {
  return task => ({
    team,
    id: task.text('id'),
    title: task.part('title').text('text'),
    owner: task.text('owner'),
    status: task.oneOf<TaskStatus>('status', STATUSES, 'open'),
    priority: task.number('priority'),
    due: task.textOrNull('due'),
  })
}

function activeOf(active: Fields): StatsDay['active'] {
  return { open: active.number('open'), 'in-progress': active.number('in-progress'), verifying: active.number('verifying'), waiting: active.number('waiting') }
}

function dayOf(day: Fields): StatsDay {
  return { day: day.text('day'), opened: day.number('opened'), done: day.number('done'), dropped: day.number('dropped'), active: activeOf(day.part('active')), atLimit: day.flag('atLimit') }
}

function spreadOf(spread: Fields): Spread {
  return { count: spread.number('count'), median: spread.numberOrNull('median'), p85: spread.numberOrNull('p85') }
}

function allOf(all: Fields): TeamPart {
  const overdue = all.part('overdue')
  const due = all.part('due')
  return {
    active: all.number('active'),
    leadTime: spreadOf(all.part('leadTime')),
    cycleTime: spreadOf(all.part('cycleTime')),
    overdue: { count: overdue.number('count'), p1: overdue.number('p1') },
    due: { total: due.number('total'), onTime: due.number('onTime') },
  }
}

function bandOf(band: Fields): { readonly label: string; readonly count: number } {
  return { label: band.text('label'), count: band.number('count') }
}

function newWorkOf(work: Fields): StatsNumbers['newWork'] {
  const source = work.part('bySource')
  return {
    total: work.number('total'),
    bySource: { self: source.number('self'), owner: source.number('owner'), lead: source.number('lead'), github: source.number('github'), session: source.number('session') },
    bugs: work.number('bugs'),
    byPriority: work.parts('byPriority').map(each => ({ priority: each.number('priority'), count: each.number('count') })),
    byGoal: work.parts('byGoal').map(each => ({ goal: each.text('goal'), count: each.number('count') })),
    noGoal: work.number('noGoal'),
  }
}

function waitsOf(waits: Fields): StatsNumbers['waits'] {
  const kind = waits.part('byKind')
  const owner = waits.part('ownerDecisions')
  return {
    waiting: waits.number('waiting'),
    byKind: { decision: kind.number('decision'), approval: kind.number('approval'), task: kind.number('task'), time: kind.number('time') },
    ownerDecisions: { count: owner.number('count'), oldestDays: owner.numberOrNull('oldestDays') },
  }
}

function healthOf(health: Fields): RegisterHealth {
  const closeOpen = health.part('closeOpen')
  const backlog = health.part('backlog')
  const overdue = health.part('overdue')
  const owner = health.part('ownerDecisions')
  const clears = health.part('backlogClears')
  return {
    closeOpen: { level: levelOf(closeOpen), ratio: closeOpen.numberOrNull('ratio') },
    backlog: { level: levelOf(backlog), net: backlog.number('net'), active: backlog.number('active') },
    overdue: { level: levelOf(overdue), count: overdue.number('count'), p1: overdue.number('p1') },
    ownerDecisions: { level: levelOf(owner), count: owner.number('count'), oldestDays: owner.numberOrNull('oldestDays') },
    backlogClears: { level: levelOf(clears), weeks: clears.numberOrNull('weeks') },
  }
}

function listsOf(behind: Fields, rows: Rows): StatsLists {
  const list = (kind: StatsListKind) => rowsOf(behind.texts(kind), rows)
  return { active: list('active'), opened: list('opened'), closed: list('closed'), overdue: list('overdue'), overdueP1: list('overdueP1'), ownerDecisions: list('ownerDecisions') }
}

/** A goal's tasks as rows, a dropped one left out: it counts for neither its done nor its open. */
function goalOf(goal: Fields, rows: Rows): StatsGoal {
  return {
    tag: goal.text('tag'),
    title: goal.text('title'),
    start: goal.text('start'),
    target: goal.text('target'),
    parent: goal.textOrNull('parent'),
    slips: goal.parts('slips').map(slip => ({ at: slip.text('at'), by: slip.text('by'), from: slip.text('from'), to: slip.text('to'), note: slip.text('note') })),
    done: goal.number('done'),
    open: goal.number('open'),
    doneDays: goal.parts('doneDays').map(day => ({ day: day.text('day'), done: day.number('done') })),
    pace: goal.number('pace'),
    forecast: goal.textOrNull('forecast'),
    state: stateOf(goal),
    rows: rowsOf(goal.texts('tasks'), rows).filter(row => row.status !== 'dropped'),
  }
}

function goalsOf(goals: Fields, rows: Rows, today: string): StatsGoals {
  return { today, offGoal: goals.number('offGoal'), doneInRange: goals.number('doneInRange'), goals: goals.parts('goals').map(goal => goalOf(goal, rows)) }
}

/** One area read, with its cells' rows set in `lists` under each cell's key. */
type AreaRead = { readonly area: Omit<StatsArea, 'standsOut'>; readonly levels: Readonly<Record<AreaMeasure, HealthLevel>> }

function areaOf(area: Fields, rows: Rows, lists: Map<string, readonly StatsListRow[]>): AreaRead {
  const team = area.text('team')
  const session = area.textOrNull('session')
  const cells = area.part('cells')
  const cell = (measure: AreaMeasure): StatsAreaCell => {
    const served = cells.part(measure)
    const listed = rowsOf(served.texts('tasks'), rows)
    lists.set(areaListKey({ team, session, measure }), listed)
    return { value: served.number('value'), usual: served.number('usual'), level: levelOf(served), listed: listed.length }
  }
  const read = { bugs: cell('bugs'), p1: cell('p1'), p1Late: cell('p1Late'), low: cell('low'), waits: cell('waits') }
  return {
    area: { team, session, active: area.number('active'), cells: read },
    levels: { bugs: read.bugs.level, p1: read.p1.level, p1Late: read.p1Late.level, low: read.low.level, waits: read.waits.level },
  }
}

/**
 * The areas of one kind, each marked as teamrig's standingOut marks it. The rule reads only the cells' levels, so it is
 * asked over the areas with no tasks: their rows are the view's, not the fold's.
 */
function groupOf(group: Fields, rows: Rows, lists: Map<string, readonly StatsListRow[]>): StatsAreaGroup {
  const median = group.part('median')
  const reads = group.parts('areas').map(area => areaOf(area, rows, lists))
  const asked: AreaStats[] = reads.map(({ area, levels }) => ({
    team: area.team,
    session: area.session,
    active: area.active,
    cells: { bugs: bare(area.cells.bugs, levels.bugs), p1: bare(area.cells.p1, levels.p1), p1Late: bare(area.cells.p1Late, levels.p1Late), low: bare(area.cells.low, levels.low), waits: bare(area.cells.waits, levels.waits) },
  }))
  const core: AreaGroup = { areas: asked, median: medianOf(median) }
  const out = new Set(standingOut(core))
  return { median: core.median, areas: reads.map(({ area }, index) => ({ ...area, standsOut: asked[index] !== undefined && out.has(asked[index]) })) }
}

function bare(cell: StatsAreaCell, level: HealthLevel): AreaStats['cells'][AreaMeasure] {
  return { value: cell.value, usual: cell.usual, level, tasks: [] }
}

function medianOf(median: Fields): AreaGroup['median'] {
  return {
    bugs: median.number('bugs'),
    p1: median.number('p1'),
    p1Late: median.number('p1Late'),
    low: median.number('low'),
    waits: median.number('waits'),
    active: median.number('active'),
  }
}

function unreadable(why: string): BodyRead<StatsRead> {
  return { kind: 'unreadable', reason: `teamrig's stats document ${why}` }
}

/**
 * What `document` says of `team`'s numbers, with the task rows left out told in one line; unreadable with any other
 * field missing or of another type. The goals' today is the last day the fold counted, the team's own calendar day.
 */
export function statsOf(document: ReadDocument, team: string): BodyRead<StatsRead> {
  const served = document.fields['tasks']
  if (!isList(served)) return unreadable('holds no task list: update teamrig')
  const tasks = listOf(served, 'stats task', rowOf(team), BY_ID)
  const rows: Rows = new Map(tasks.values.map(row => [row.id, row]))
  const head = new Fields(document.fields)
  const at = head.moment('at')
  const validUntil = head.moment('validUntil')
  const range = head.oneOf<StatsRange>('range', RANGES, 'all')
  const days = head.parts('days').map(dayOf)
  const all = allOf(head.part('all'))
  const recent = head.part('recent')
  const bugs = head.part('bugs')
  const areaLists = new Map<string, readonly StatsListRow[]>()
  const areas = head.part('areas')
  const today = days.at(-1)?.day ?? new Date(at).toISOString().slice(0, 10)
  const stats: StatsNumbers = {
    range,
    days,
    opened: head.number('opened'),
    closedTasks: head.number('closedTasks'),
    droppedTasks: head.number('droppedTasks'),
    net: head.number('net'),
    closes: head.number('closes'),
    recent: { days: recent.number('days'), net: recent.number('net') },
    active: activeOf(head.part('active')),
    all,
    teams: [{ team, ...all }],
    newWork: newWorkOf(head.part('newWork')),
    activeByAge: head.parts('activeByAge').map(bandOf),
    neverStarted: head.number('neverStarted'),
    lateDays: head.parts('lateDays').map(bandOf),
    dueMoved: head.number('dueMoved'),
    waits: waitsOf(head.part('waits')),
    bugs: { active: bugs.number('active'), opened: bugs.number('opened'), fixed: bugs.number('fixed') },
    people: head.parts('people').map(each => ({ team: each.text('team'), session: each.text('session'), done: each.number('done') })),
    splits: head.parts('splits').map(each => ({ day: each.text('day'), from: each.text('from'), to: each.text('to'), tasks: each.number('tasks') })),
    goals: goalsOf(head.part('goals'), rows, today),
    areas: { teams: groupOf(areas.part('teams'), rows, areaLists), sessions: groupOf(areas.part('sessions'), rows, areaLists) },
  }
  const health = healthOf(head.part('health'))
  const lists = listsOf(head.part('behind'), rows)
  const session = head.textOrNull('session')
  const [missing] = head.bad
  if (missing !== undefined) return unreadable(`cannot be read (${missing}): update teamrig`)
  return {
    kind: 'read',
    value: { at, validUntil, session, stats, health, lists, areaLists },
    problems: tasks.left.length === 0 ? [] : [leftOutLine('stats task', tasks.left)],
  }
}
