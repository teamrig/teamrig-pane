// The documents of `teamrig read` as interface 1.0 serves them, for the specs of what reads them
// (document-source.test.ts) and for the fake teamrig that answers a run from a register's files (fake-read.ts): one
// builder per document and per row, the words a run was asked with, and a run's answer or refusal (T4742).
import type { JsonRecord } from '../hooks/read-document'
import type { CliRun } from '../hooks/teamrig-cli'
import { HOUR, NOW } from './fixtures'

export const AN_HOUR_AGO = new Date(NOW - HOUR).toISOString()

/** A task as interface 1.0 serves it, open and owned by api. */
export function task(id: string, over: JsonRecord = {}): JsonRecord {
  return {
    id,
    title: { text: `Title of ${id}`, source: 'team' },
    description: null,
    owner: 'api',
    priority: 2,
    type: 'task',
    critical: false,
    due: null,
    status: 'open',
    note: null,
    proof: null,
    evidence: null,
    skill: null,
    statusAt: AN_HOUR_AGO,
    source: { kind: 'session', id: 'lead', name: 'shop-lead' },
    ref: null,
    goals: [],
    week: null,
    size: null,
    pin: null,
    workClass: null,
    createdBy: 'lead',
    createdAt: AN_HOUR_AGO,
    updatedAt: AN_HOUR_AGO,
    updatedBy: 'lead',
    priorityAt: AN_HOUR_AGO,
    assignedAt: AN_HOUR_AGO,
    ownerSeenAt: null,
    waits: [],
    answer: null,
    decided: null,
    after: [],
    ...over,
  }
}

export function tasksDocument(revision: string, tasks: readonly JsonRecord[], over: JsonRecord = {}): JsonRecord {
  return { interface: '1.0', document: 'tasks', revision, problems: [], tasks, cuts: [], ...over }
}

/** A session of team shop as interface 1.0 serves it, led by `leader`. */
export function session(id: string, leader: string | null, over: JsonRecord = {}): JsonRecord {
  return {
    team: 'shop',
    id,
    name: `shop-${id}`,
    formerNames: [],
    roles: leader === null ? ['lead'] : [],
    leader,
    ledBy: leader === null ? [] : [leader],
    leads: leader === null ? 2 : 0,
    active: true,
    launch: null,
    hire: null,
    rehiredFrom: null,
    retire: null,
    unread: 0,
    state: 'idle',
    ask: null,
    since: AN_HOUR_AGO,
    host: null,
    conversation: null,
    ...over,
  }
}

export const TEAM_SESSIONS = [session('lead', null), session('api', 'lead'), session('web', 'lead')]

export function sessionsDocument(revision: string, over: JsonRecord = {}): JsonRecord {
  return {
    interface: '1.0',
    document: 'sessions',
    revision,
    problems: [],
    self: { team: 'shop', session: 'api' },
    teams: [{ id: 'shop', parent: null, active: 3, retired: 0 }],
    sessions: TEAM_SESSIONS,
    failures: [],
    cuts: [],
    ...over,
  }
}

export function inboxDocument(revision: string, id: string, over: JsonRecord = {}): JsonRecord {
  return {
    interface: '1.0',
    document: 'inbox',
    revision,
    problems: [],
    session: { id, name: `shop-${id}` },
    unread: 1,
    lines: [{ key: `${id}-1`, at: AN_HOUR_AGO, from: 'lead', text: { text: `a line for ${id}`, source: 'team' }, unread: true }],
    cuts: [],
    ...over,
  }
}

/** Every setting the pane draws with, each with a value the fold's settings do not hold. */
export const SERVED_SETTINGS: readonly (readonly [string, unknown])[] = [
  ['register.ownerSource', 'boss'],
  ['register.requireDecisionCard', false],
  ['register.check.notPickedUpAfterHours', 36],
  ['focus.defaultClass', 'Improvements'],
  ['focus.roadmapClass', 'Roadmap'],
  ['focus.maintenanceClass', 'Upkeep'],
  ['focus.parkAfterDays', 9],
  ['focus.score.rankValues', [100, 80, 60]],
  ['focus.score.roadmapUnranked', 41],
  ['focus.score.maintenanceValue', 42],
  ['focus.score.maintenanceBug', 43],
  ['focus.score.maintenanceCritical', 44],
  ['focus.score.improvementsValue', 45],
  ['focus.score.overdueValue', 46],
  ['focus.score.dueSoonValue', 47],
  ['focus.score.dueSoonDays', 3],
  ['focus.score.unblocksShare', 0.25],
  ['focus.score.ownerOrderValues', [140, 120]],
  ['focus.score.defaultSizePct', 2.5],
  ['focus.score.minSizePct', 0.5],
  ['focus.expedite.critical', true],
  ['focus.expedite.ownerP1', false],
]

/** The `config` document's rows for `settings`, each key at its own value with no problem. */
export function settingRows(settings: readonly (readonly [string, unknown])[]): JsonRecord[] {
  return settings.map(([path, value]) => ({ path, value, default: value, problem: null }))
}

export function configDocument(revision: string, over: JsonRecord = {}): JsonRecord {
  return {
    interface: '1.0',
    document: 'config',
    revision,
    problems: [],
    team: 'shop',
    teams: [],
    timeZone: 'Asia/Jerusalem',
    settings: settingRows(SERVED_SETTINGS),
    cuts: [],
    ...over,
  }
}

/** An active task as interface 1.1's `plan` places it: ready, unranked by any goal, needing and needed by nothing, its owner's to work. */
export function planned(id: string, over: JsonRecord = {}): JsonRecord {
  return {
    id,
    parked: false,
    pinned: false,
    band: 3,
    ready: true,
    score: 18,
    started: false,
    due: null,
    unblocks: null,
    inWeek: false,
    size: null,
    costOfDelay: 45,
    sizePct: 2.5,
    workClass: 'Improvements',
    goal: null,
    prep: false,
    needs: [],
    neededBy: [],
    next: { kind: 'work', who: 'api', task: id, behind: null },
    ...over,
  }
}

/** The `plan` document for `tasks`, in the order given, which is their rank. */
export function planDocument(revision: string, tasks: readonly JsonRecord[], over: JsonRecord = {}): JsonRecord {
  return { interface: '1.1', document: 'plan', revision, problems: [], at: new Date(NOW).toISOString(), validUntil: null, week: null, tasks, finished: [], ...over }
}

/** A task as the `stats` document names it, slim: open, owned by api, p2, with no due date. */
export function statsTask(id: string, over: JsonRecord = {}): JsonRecord {
  return { id, title: { text: `Title of ${id}`, source: 'team' }, owner: 'api', priority: 2, status: 'open', due: null, ...over }
}

/** An area cell as the `stats` document serves it: all clear, counting `tasks`. */
export function areaCell(tasks: readonly string[] = [], over: JsonRecord = {}): JsonRecord {
  return { value: tasks.length, usual: tasks.length, level: 'good', tasks, ...over }
}

/** A session of team shop as an area, every cell all clear and empty unless `cells` says otherwise. */
export function statsArea(session: string | null, cells: JsonRecord = {}, over: JsonRecord = {}): JsonRecord {
  return {
    team: 'shop',
    session,
    active: 1,
    cells: { bugs: areaCell(), p1: areaCell(), p1Late: areaCell(), low: areaCell(), waits: areaCell(), ...cells },
    ...over,
  }
}

const ZERO_MEDIAN = { bugs: 0, p1: 0, p1Late: 0, low: 0, waits: 0, active: 0 }

/**
 * The `stats` document of team shop as interface 1.6 serves it (teamrig src/interface/stats.ts StatsBody): one day, no
 * goal and no area, T1 behind the active count; `over` sets any field.
 */
export function statsDocument(revision: string, over: JsonRecord = {}): JsonRecord {
  const zeroActive = { open: 0, 'in-progress': 0, verifying: 0, waiting: 0 }
  return {
    interface: '1.6',
    document: 'stats',
    revision,
    problems: [],
    at: new Date(NOW).toISOString(),
    validUntil: new Date(NOW + HOUR).toISOString(),
    range: '30d',
    session: null,
    days: [{ day: '2026-03-02', opened: 1, done: 0, dropped: 0, active: { ...zeroActive, open: 1 }, atLimit: false }],
    opened: 1,
    closedTasks: 0,
    droppedTasks: 0,
    net: 1,
    closes: 0,
    recent: { days: 14, net: 1 },
    active: { ...zeroActive, open: 1 },
    all: { active: 1, leadTime: { count: 0, median: null, p85: null }, cycleTime: { count: 0, median: null, p85: null }, overdue: { count: 0, p1: 0 }, due: { total: 0, onTime: 0 } },
    newWork: { total: 1, bySource: { self: 0, owner: 0, lead: 1, github: 0, session: 0 }, bugs: 0, byPriority: [{ priority: 2, count: 1 }], byGoal: [], noGoal: 1 },
    activeByAge: [{ label: '0-1 d', count: 1 }],
    neverStarted: 0,
    lateDays: [],
    dueMoved: 0,
    waits: { waiting: 0, byKind: { decision: 0, approval: 0, task: 0, time: 0 }, ownerDecisions: { count: 0, oldestDays: null } },
    bugs: { active: 0, opened: 0, fixed: 0 },
    people: [],
    splits: [],
    health: {
      closeOpen: { level: 'warn', ratio: 0 },
      backlog: { level: 'good', net: 1, active: 1 },
      overdue: { level: 'good', count: 0, p1: 0 },
      ownerDecisions: { level: 'good', count: 0, oldestDays: null },
      backlogClears: { level: 'good', weeks: null },
    },
    behind: { active: ['T1'], opened: ['T1'], closed: [], overdue: [], overdueP1: [], ownerDecisions: [] },
    goals: { goals: [], offGoal: 0, doneInRange: 0 },
    areas: { teams: { areas: [], median: ZERO_MEDIAN }, sessions: { areas: [], median: ZERO_MEDIAN } },
    tasks: [statsTask('T1')],
    cuts: [],
    ...over,
  }
}

/** A step as interface 1.9's `steps` document serves it (teamrig src/interface/steps.ts ServedStep). */
export function servedStep(id: string, over: JsonRecord = {}): JsonRecord {
  return { id, title: `Title of ${id}`, why: `Why ${id} is needed`, preview: [`${id} changes this`], command: `/teamrig steps run ${id} --yes`, ...over }
}

/** The `steps` document listing `steps`, in the order given, which is the order they are taken. */
export function stepsDocument(revision: string, steps: readonly JsonRecord[], over: JsonRecord = {}): JsonRecord {
  return { interface: '1.9', document: 'steps', revision, problems: [], steps, cuts: [], ...over }
}

/** One run as the fake teamrig was asked it. */
export type Asked = { documents: readonly string[]; session: string | null; unless: string | null; conversation: string | null }

export function askedOf(argv: readonly string[]): Asked {
  const words = argv.slice(argv.indexOf('read') + 1)
  const flag = (name: string): string | null => {
    const at = words.indexOf(name)
    return at < 0 ? null : (words[at + 1] ?? null)
  }
  return { documents: words.slice(0, words.indexOf('--json')), session: flag('--session'), unless: flag('--unless'), conversation: flag('--conversation') }
}

/** How a `read stats` run narrowed its document: a team above the caller's, one session's tasks, the range counted. */
export type StatsAsked = { team: string | null; owner: string | null; range: string | null }

export function statsAskedOf(argv: readonly string[]): StatsAsked {
  const flag = (name: string): string | null => {
    const at = argv.indexOf(name)
    return at < 0 ? null : (argv[at + 1] ?? null)
  }
  return { team: flag('--team'), owner: flag('--owner'), range: flag('--range') }
}

export function printed(...documents: readonly JsonRecord[]): CliRun {
  return { exitCode: 0, stdout: documents.map(document => JSON.stringify(document)).join('\n'), stderr: '', isStdoutTruncated: false }
}

export function refused(why: string): CliRun {
  return { exitCode: 2, stdout: '', stderr: `REFUSED ${why}`, isStdoutTruncated: false }
}
