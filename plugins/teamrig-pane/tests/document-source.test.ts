// The snapshot with what `teamrig read` serves laid over the file fold (hooks/document-source.ts): which documents a
// poll asks for and as whom, when it reads at all, what it draws from each document and what it keeps from the fold,
// and that a failed run or an unreadable document keeps what was drawn under its reason, with no title ever taken
// from the fold (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { TimeZone } from '../hooks/core/read/index'
import { DocumentSource, READ_EVERY_MS, titledCards, type FileSource } from '../hooks/document-source'
import type { PlanRead } from '../hooks/plan-document'
import { parseDocument, type JsonRecord } from '../hooks/read-document'
import type { ReadPorts } from '../hooks/read-port'
import { CONTROL_SHOWN } from '../hooks/shown-text'
import type { FilePoll, PollInput } from '../hooks/source'
import { tasksOf } from '../hooks/tasks-document'
import type { CliRun, TeamrigCli } from '../hooks/teamrig-cli'
import type { Snapshot, TaskRow } from '../types'
import { HOUR, NO_TEAM, NOW, SNAPSHOT_SETTINGS } from './fixtures'
import { AN_HOUR_AGO, askedOf, configDocument, inboxDocument, planDocument, planned, printed, refused, session, sessionsDocument, task, tasksDocument, type Asked } from './served-documents'

const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }
const DAY = 24 * HOUR
/** What a teamrig of interface 1.0 answers a run that names the plan. */
const UNKNOWN_PLAN = 'unknown document "plan"; the documents are tasks, inbox, sessions, config'

/**
 * A teamrig answering `read` by the words asked: each document as it stands, `unchanged` for one asked with the
 * revision it is at, a session's own inbox, and a refusal of the whole run for a session with no inbox here.
 */
class FakeTeamrig {
  tasks: JsonRecord = tasksDocument('t1', [task('T1'), task('T2', { owner: 'web' })])
  sessions: JsonRecord = sessionsDocument('s1')
  config: JsonRecord = configDocument('c1')
  inboxes: Record<string, JsonRecord> = { api: inboxDocument('i1', 'api'), lead: inboxDocument('i7', 'lead') }
  /** The plan as interface 1.1 serves it; null: a teamrig of interface 1.0, which refuses a run that names it. */
  plan: JsonRecord | null = planDocument('p1', [planned('T1')])
  /** Answers every run in place of the documents, an Error by rejecting; null: the documents. */
  broken: CliRun | Error | null = null
  readonly asked: Asked[] = []
  readonly ports: ReadPorts

  constructor() {
    this.ports = {
      run: argv => {
        const asked = askedOf(argv)
        this.asked.push(asked)
        if (this.broken instanceof Error) return Promise.reject(this.broken)
        return Promise.resolve(this.broken ?? this.answer(asked))
      },
    }
  }

  /** The runs asked since the last call. */
  taken(): Asked[] {
    return this.asked.splice(0)
  }

  private answer(asked: Asked): CliRun {
    const held = new Set((asked.unless ?? '').split(','))
    const documents: JsonRecord[] = []
    for (const name of asked.documents) {
      if (name === 'plan' && this.plan === null) return refused(UNKNOWN_PLAN)
      const document = name === 'plan' ? this.plan : this.documentOf(name, asked.session)
      if (document === null) return refused(`session ${asked.session ?? '(none)'} is not on team shop`)
      const revision = String(document['revision'])
      documents.push(held.has(`${name}=${revision}`) ? { interface: '1.0', document: name, revision, unchanged: true } : document)
    }
    return printed(...documents)
  }

  private documentOf(name: string, session: string | null): JsonRecord | null {
    if (name === 'tasks') return this.tasks
    if (name === 'sessions') return this.sessions
    if (name === 'config') return this.config
    return session === null ? null : (this.inboxes[session] ?? null)
  }
}

/** The rows the tasks reader makes of `tasks`, as the file fold would hold them. */
function rowsOf(tasks: readonly JsonRecord[]): TaskRow[] {
  const document = parseDocument(tasksDocument('fold', tasks))
  if (document.kind !== 'document') throw new Error(`no document: ${document.kind}`)
  const read = tasksOf(document.document)
  if (read.kind !== 'read') throw new Error(read.reason)
  return read.value
}

/** What the file fold answers for team shop: its own rows, area, inbox and settings, none of which may be drawn. */
const BASE: Snapshot = {
  ...NO_TEAM,
  ...SNAPSHOT_SETTINGS,
  tasks: rowsOf([task('T1', { title: { text: 'A title from the fold', source: 'team' } })]),
  area: 'fold-area',
  areaSource: 'inbox-read',
  areaName: 'fold-name',
  leads: { lead: 'fold-lead', leaderOf: {} },
  team: 'shop',
  unreadInbox: 9,
  inbox: [{ key: 'inbox:0', at: NOW, from: 'fold', text: 'a line from the fold', unread: true }],
  problem: null,
  ownerCards: { api: { due: [{ id: 'T1', title: 'A title from the fold' }], later: [] } },
  work: [{ session: 'api', task: 'T1', at: NOW - HOUR }],
  now: NOW,
}

/**
 * A file source answering `next` once, then null (nothing moved) until it is set again; an Error is thrown. The move
 * is of a file a served document is built from unless `numbers` sets it as one of the numbers alone.
 */
class FakeFiles implements FileSource {
  next: Snapshot | Error | null
  private isServedMoved = true
  readonly polls: PollInput[] = []

  constructor(first: Snapshot | Error | null = BASE) {
    this.next = first
  }

  /** The next poll answers `snapshot` as a move no served document is built from. */
  numbers(snapshot: Snapshot): void {
    this.next = snapshot
    this.isServedMoved = false
  }

  pollFiles(input: PollInput): Promise<FilePoll | null> {
    this.polls.push(input)
    const next = this.next
    const isServedMoved = this.isServedMoved
    this.next = null
    this.isServedMoved = true
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next === null ? null : { snapshot: next, isServedMoved })
  }
}

type Rig = { teamrig: FakeTeamrig; files: FakeFiles; source: DocumentSource }

function rig(first: Snapshot | Error | null = BASE, cli: TeamrigCli = CLI): Rig {
  const teamrig = new FakeTeamrig()
  const files = new FakeFiles(first)
  return { teamrig, files, source: new DocumentSource(files, cli, teamrig.ports) }
}

function input(over: Partial<PollInput> = {}): PollInput {
  return { claudeSession: 'c-1', pinned: null, now: NOW, ...over }
}

/** A poll that must answer a snapshot. */
async function drawn(source: DocumentSource, over: Partial<PollInput> = {}): Promise<Snapshot> {
  const snapshot = await source.poll(input(over))
  if (snapshot === null) throw new Error('the poll answered no snapshot')
  return snapshot
}

/** The message a poll rejected with; null when it answered. */
async function rejection(poll: Promise<unknown>): Promise<string | null> {
  return poll.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
}

function titles(snapshot: Snapshot): string[] {
  return snapshot.tasks.map(row => `${row.id} ${row.title}`)
}

describe('DocumentSource: who a poll asks as', () => {
  test('the first poll reads tasks, sessions and config by the conversation, then the inbox of the session it runs', async () => {
    const { teamrig, files, source } = rig()
    const snapshot = await drawn(source)
    expect(teamrig.asked).toEqual([
      { documents: ['tasks', 'sessions', 'config', 'plan'], session: null, unless: null, conversation: 'c-1' },
      { documents: ['inbox'], session: 'api', unless: null, conversation: 'c-1' },
    ])
    expect(files.polls).toEqual([input()])
    expect(titles(snapshot)).toEqual(['T1 Title of T1', 'T2 Title of T2'])
    expect(snapshot.area).toBe('api')
    expect(snapshot.areaSource).toBe('inbox-read')
    expect(snapshot.areaName).toBe('shop-api')
    expect(snapshot.leads).toEqual({ lead: 'lead', leaderOf: { api: 'lead', web: 'lead' } })
    expect(snapshot.unreadInbox).toBe(1)
    expect(snapshot.inbox).toEqual([{ key: 'api-1', at: NOW - HOUR, from: 'lead', text: 'a line for api', unread: true }])
    expect(snapshot.problem).toBeNull()
  })

  test('once the area is known to be on the team, one run asks every document as it', async () => {
    const { teamrig, files, source } = rig()
    await drawn(source)
    teamrig.taken()
    files.next = BASE
    await drawn(source)
    expect(teamrig.asked).toEqual([{ documents: ['tasks', 'sessions', 'config', 'inbox', 'plan'], session: 'api', unless: 'tasks=t1,sessions=s1,config=c1,inbox=i1,plan=p1', conversation: 'c-1' }])
  })

  test('a pinned session on the team is the area, and its inbox the one drawn', async () => {
    const { teamrig, source } = rig()
    const snapshot = await drawn(source, { pinned: 'lead' })
    expect(teamrig.taken().map(asked => [asked.documents.join(' '), asked.session])).toEqual([
      ['tasks sessions config plan', null],
      ['inbox', 'lead'],
    ])
    expect(snapshot.area).toBe('lead')
    expect(snapshot.areaSource).toBe('pinned')
    expect(snapshot.areaName).toBe('shop-lead')
    expect(snapshot.inbox.map(item => item.text)).toEqual(['a line for lead'])
    await drawn(source, { pinned: 'lead', force: true })
    expect(teamrig.asked.map(asked => [asked.documents.join(' '), asked.session])).toEqual([['tasks sessions config inbox plan', 'lead']])
  })

  test('a pinned word the team does not hold names no session and asks for no inbox', async () => {
    const { teamrig, source } = rig()
    const snapshot = await drawn(source, { pinned: 'ghost' })
    await drawn(source, { pinned: 'ghost', force: true })
    expect(teamrig.asked.map(asked => [asked.documents.join(' '), asked.session])).toEqual([
      ['tasks sessions config plan', null],
      ['tasks sessions config plan', null],
    ])
    expect(snapshot.area).toBe('ghost')
    expect(snapshot.areaSource).toBe('pinned')
    expect(snapshot.areaName).toBeNull()
    expect(snapshot.unreadInbox).toBeNull()
    expect(snapshot.inbox).toEqual([])
    expect(snapshot.problem).toBeNull()
  })

  test('a conversation of another team than the pane draws has no area', async () => {
    const { teamrig, source } = rig()
    teamrig.sessions = sessionsDocument('s1', { self: { team: 'other', session: 'api' } })
    const snapshot = await drawn(source)
    expect(teamrig.asked).toHaveLength(1)
    expect(snapshot.area).toBeNull()
    expect(snapshot.areaSource).toBeNull()
    expect(snapshot.areaName).toBeNull()
    expect(snapshot.inbox).toEqual([])
  })

  test('with no team found, no session is the area and nobody leads', async () => {
    const { teamrig, source } = rig({ ...BASE, team: null })
    const snapshot = await drawn(source, { pinned: 'api' })
    expect(teamrig.asked).toHaveLength(1)
    expect(snapshot.area).toBe('api')
    expect(snapshot.areaName).toBeNull()
    expect(snapshot.leads).toBeNull()
    expect(snapshot.notPickedUpAfterHours).toBe(SNAPSHOT_SETTINGS.notPickedUpAfterHours)
  })

  test('a session retired since the sessions document was held does not refuse every later read', async () => {
    const { teamrig, files, source } = rig()
    await drawn(source)
    teamrig.taken()
    teamrig.inboxes = {}
    teamrig.sessions = sessionsDocument('s2', { self: null, sessions: [session('lead', null), session('web', 'lead')] })
    teamrig.tasks = tasksDocument('t2', [task('T3')])
    files.next = BASE
    const snapshot = await drawn(source, { pinned: 'api' })
    expect(teamrig.taken().map(asked => [asked.documents.join(' '), asked.session])).toEqual([
      ['tasks sessions config inbox plan', 'api'],
      ['tasks sessions config inbox', 'api'],
      ['tasks sessions config', null],
    ])
    expect(titles(snapshot)).toEqual(['T3 Title of T3'])
    expect(snapshot.areaName).toBeNull()
    expect(snapshot.inbox).toEqual([])
    expect(snapshot.problem).toBe('REFUSED session api is not on team shop')
    const later = await drawn(source, { pinned: 'api', force: true })
    expect(teamrig.asked.map(asked => asked.session)).toEqual([null])
    expect(later.problem).toBeNull()
  })
})

describe('DocumentSource: when it reads', () => {
  test('no run while nothing moved, until the documents stood unread for READ_EVERY_MS', async () => {
    const { teamrig, source } = rig()
    await drawn(source)
    teamrig.taken()
    expect(await source.poll(input({ now: NOW + READ_EVERY_MS - 1 }))).toBeNull()
    expect(teamrig.asked).toEqual([])
    const snapshot = await drawn(source, { now: NOW + READ_EVERY_MS })
    expect(teamrig.asked).toHaveLength(1)
    expect(snapshot.now).toBe(NOW + READ_EVERY_MS)
    expect(await source.poll(input({ now: NOW + READ_EVERY_MS + 1 }))).toBeNull()
  })

  test('a moved file reads at once, and so does force', async () => {
    const { teamrig, files, source } = rig()
    await drawn(source)
    teamrig.taken()
    files.next = { ...BASE, work: [] }
    const moved = await drawn(source, { now: NOW + 1 })
    expect(teamrig.taken()).toHaveLength(1)
    expect(moved.work).toEqual([])
    await drawn(source, { now: NOW + 2, force: true })
    expect(teamrig.taken()).toHaveLength(1)
  })

  test('a move of the numbers alone is drawn with the documents held and starts no run, until READ_EVERY_MS', async () => {
    const { teamrig, files, source } = rig()
    await drawn(source)
    teamrig.taken()
    teamrig.tasks = tasksDocument('t2', [task('T5')])
    files.numbers({ ...BASE, work: [] })
    const numbers = await drawn(source, { now: NOW + 1 })
    expect(teamrig.asked).toEqual([])
    expect(numbers.work).toEqual([])
    expect(numbers.now).toBe(NOW + 1)
    expect(titles(numbers)).toEqual(['T1 Title of T1', 'T2 Title of T2'])
    expect(await source.poll(input({ now: NOW + READ_EVERY_MS - 1 }))).toBeNull()
    expect(teamrig.asked).toEqual([])
    files.numbers(BASE)
    const late = await drawn(source, { now: NOW + READ_EVERY_MS })
    expect(teamrig.taken()).toHaveLength(1)
    expect(titles(late)).toEqual(['T5 Title of T5'])
  })

  test('the first poll reads though only numbers moved', async () => {
    const { teamrig, files, source } = rig(null)
    files.numbers(BASE)
    await drawn(source)
    expect(teamrig.asked.map(asked => asked.documents.join(' '))).toEqual(['tasks sessions config plan', 'inbox'])
  })

  test('with no snapshot of the files yet there is nothing to draw on, and nothing is run', async () => {
    const { teamrig, source } = rig(null)
    expect(await source.poll(input())).toBeNull()
    expect(teamrig.asked).toEqual([])
  })

  test('a throw of the file source passes through', async () => {
    const { source } = rig(new Error('the register cannot be read'))
    expect(await rejection(source.poll(input()))).toBe('the register cannot be read')
  })

  test('hands back the revisions held, and an unchanged answer keeps what was drawn', async () => {
    const { teamrig, source } = rig()
    const first = await drawn(source)
    teamrig.taken()
    teamrig.tasks = tasksDocument('t2', [task('T5')])
    const second = await drawn(source, { force: true })
    expect(teamrig.taken().map(asked => asked.unless)).toEqual(['tasks=t1,sessions=s1,config=c1,inbox=i1,plan=p1'])
    expect(titles(second)).toEqual(['T5 Title of T5'])
    expect(second.inbox).toEqual(first.inbox)
    expect(second.leads).toEqual(first.leads)
    expect(second.notPickedUpAfterHours).toBe(36)
    await drawn(source, { force: true })
    expect(teamrig.asked.map(asked => asked.unless)).toEqual(['tasks=t2,sessions=s1,config=c1,inbox=i1,plan=p1'])
  })
})

describe('DocumentSource: what it draws', () => {
  test("the settings are the config document's, the rest of the fold is kept, and the clock is the poll's", async () => {
    const { source } = rig()
    const snapshot = await drawn(source, { now: NOW + 5 })
    expect(snapshot.notPickedUpAfterHours).toBe(36)
    expect(snapshot.timeZone).toBe('Asia/Jerusalem')
    expect(snapshot.ownerSource).toBe('boss')
    expect(snapshot.focus.parkAfterDays).toBe(9)
    expect(snapshot.team).toBe('shop')
    expect(snapshot.work).toEqual(BASE.work)
    expect(snapshot.goals).toBe(BASE.goals)
    expect(snapshot.spend).toBe(BASE.spend)
    expect(snapshot.taskCounts).toBe(BASE.taskCounts)
    expect(snapshot.now).toBe(NOW + 5)
  })

  test('a config document of no team, or of another team, leaves the settings the pane started with', async () => {
    const none = rig()
    none.teamrig.config = configDocument('c1', { team: null, teams: ['shop'] })
    const teamless = await drawn(none.source)
    expect(teamless.notPickedUpAfterHours).toBe(SNAPSHOT_SETTINGS.notPickedUpAfterHours)
    expect(teamless.problem).toBeNull()
    const other = rig()
    other.teamrig.config = configDocument('c1', { team: 'bakery' })
    const snapshot = await drawn(other.source)
    expect(snapshot.timeZone).toBe(SNAPSHOT_SETTINGS.timeZone)
    expect(snapshot.problem).toBe('teamrig read answers for team bakery, the pane found team shop')
  })

  test('holds the active tasks and those finished within the held days', async () => {
    const { teamrig, source } = rig()
    teamrig.tasks = tasksDocument('t1', [
      task('T1', { status: 'done', statusAt: new Date(NOW - 9 * DAY).toISOString() }),
      task('T2', { status: 'done', statusAt: new Date(NOW - 7 * DAY).toISOString() }),
      task('T3', { status: 'waiting' }),
    ])
    expect((await drawn(source)).tasks.map(row => row.id)).toEqual(['T2', 'T3'])
  })

  test("the owner cards are the plan document's, titled by the document's row, never the fold's", async () => {
    const { teamrig, source } = rig({ ...BASE, ownerCards: { web: { due: [{ id: 'T1', title: 'A card from the fold' }], later: [] } } })
    teamrig.plan = planDocument('p1', [planned('T1')], { interface: '1.5', ownerCards: [{ session: 'api', due: ['T1', 'T77'], later: [] }] })
    expect((await drawn(source)).ownerCards).toEqual({ api: { due: [{ id: 'T1', title: 'Title of T1' }], later: [] } })
  })

  test('a teamrig older than interface 1.5 serves no owner cards, so none are drawn, not even the fold\'s', async () => {
    const { source } = rig({ ...BASE, ownerCards: { api: { due: [{ id: 'T1', title: 'A card from the fold' }], later: [] } } })
    expect((await drawn(source)).ownerCards).toEqual({})
  })

  test('the inbox line window moves with the clock', async () => {
    const { teamrig, source } = rig()
    teamrig.inboxes = {
      api: inboxDocument('i1', 'api', { unread: 0, lines: [{ key: 'old', at: new Date(NOW - 23 * HOUR).toISOString(), from: null, text: { text: 'read long ago', source: 'team' }, unread: false }] }),
    }
    expect((await drawn(source)).inbox.map(item => item.key)).toEqual(['old'])
    expect((await drawn(source, { now: NOW + 2 * HOUR })).inbox).toEqual([])
  })

  test('what teamrig could not serve of a document is shown, and stays while the document is unchanged', async () => {
    const { teamrig, source } = rig()
    teamrig.tasks = tasksDocument('t1', [task('T1')], { problems: ['2 tasks could not be served'] })
    expect((await drawn(source)).problem).toBe('2 tasks could not be served')
    expect((await drawn(source, { force: true })).problem).toBe('2 tasks could not be served')
  })

  test("the fold's own problem is kept beside the documents'", async () => {
    const { teamrig, source } = rig({ ...BASE, problem: 'skipped 1 line of the register' })
    teamrig.sessions = sessionsDocument('s1', { problems: ['team bakery cannot be read'] })
    expect((await drawn(source)).problem).toBe('skipped 1 line of the register; team bakery cannot be read')
  })
})

describe('DocumentSource: a read that fails', () => {
  test("before the first tasks document the list is empty under the reason, never the fold's rows", async () => {
    const { teamrig, source } = rig()
    teamrig.broken = refused('read is not a command of this teamrig')
    const snapshot = await drawn(source)
    expect(snapshot.tasks).toEqual([])
    expect(snapshot.ownerCards).toEqual({})
    expect(snapshot.area).toBeNull()
    expect(snapshot.areaName).toBeNull()
    expect(snapshot.leads).toBeNull()
    expect(snapshot.unreadInbox).toBeNull()
    expect(snapshot.inbox).toEqual([])
    expect(snapshot.notPickedUpAfterHours).toBe(SNAPSHOT_SETTINGS.notPickedUpAfterHours)
    expect(snapshot.problem).toBe('REFUSED read is not a command of this teamrig')
  })

  test('a teamrig that cannot be found is the named problem, and nothing is run', async () => {
    const { teamrig, source } = rig(BASE, { kind: 'missing', problem: 'teamrig is not installed: install the teamrig plugin' })
    const snapshot = await drawn(source)
    expect(teamrig.asked).toEqual([])
    expect(snapshot.tasks).toEqual([])
    expect(snapshot.problem).toBe('teamrig is not installed: install the teamrig plugin')
  })

  test('a failed run keeps everything last drawn and names its reason, until a run answers again', async () => {
    const { teamrig, source } = rig()
    const good = await drawn(source)
    teamrig.taken()
    teamrig.broken = new Error('timed out')
    const failed = await drawn(source, { force: true })
    expect(teamrig.taken().map(asked => [asked.documents.join(' '), asked.session])).toEqual([
      ['tasks sessions config inbox plan', 'api'],
      ['tasks sessions config inbox', 'api'],
      ['tasks sessions config', null],
    ])
    expect(failed.problem).toBe('teamrig read did not finish: timed out')
    expect({ ...failed, problem: null }).toEqual(good)
    teamrig.broken = null
    expect(await drawn(source, { force: true })).toEqual(good)
  })

  test('a document that cannot be read keeps its last value and revision under the reason', async () => {
    const { teamrig, source } = rig()
    const good = await drawn(source)
    teamrig.taken()
    teamrig.tasks = { interface: '1.0', document: 'tasks', revision: 't2', problems: [] }
    const bad = await drawn(source, { force: true })
    expect(titles(bad)).toEqual(titles(good))
    expect(bad.problem).toBe("teamrig's tasks document holds no task list: update teamrig")
    await drawn(source, { force: true })
    expect(teamrig.taken().map(asked => asked.unless)).toEqual(['tasks=t1,sessions=s1,config=c1,inbox=i1,plan=p1', 'tasks=t1,sessions=s1,config=c1,inbox=i1,plan=p1'])
    teamrig.tasks = tasksDocument('t1', [task('T1'), task('T2', { owner: 'web' })])
    expect((await drawn(source, { force: true })).problem).toBeNull()
  })

  test('a document a run did not print is named, and the others are drawn', async () => {
    const { teamrig, source } = rig()
    teamrig.broken = printed(tasksDocument('t1', [task('T4')]))
    const snapshot = await drawn(source)
    expect(titles(snapshot)).toEqual(['T4 Title of T4'])
    expect(snapshot.problem).toBe('teamrig read printed no sessions document; teamrig read printed no config document; teamrig read printed no plan document')
  })

  test('the inbox of another session is never drawn', async () => {
    const { teamrig, source } = rig()
    expect((await drawn(source)).inbox).toHaveLength(1)
    teamrig.taken()
    teamrig.inboxes = { api: inboxDocument('i1', 'api'), lead: { interface: '1.0', document: 'inbox', revision: 'i8', problems: [] } }
    const snapshot = await drawn(source, { pinned: 'lead', force: true })
    expect(teamrig.asked.map(asked => [asked.documents.join(' '), asked.session, asked.unless])).toEqual([['tasks sessions config inbox plan', 'lead', 'tasks=t1,sessions=s1,config=c1,plan=p1']])
    expect(snapshot.area).toBe('lead')
    expect(snapshot.unreadInbox).toBeNull()
    expect(snapshot.inbox).toEqual([])
    expect(snapshot.problem).toContain("teamrig's inbox document")
  })

  test("what an earlier area's inbox could not serve is not shown for the next area", async () => {
    const { teamrig, source } = rig()
    teamrig.inboxes = { api: inboxDocument('i1', 'api', { problems: ['1 line of api could not be served'] }) }
    expect((await drawn(source)).problem).toBe('1 line of api could not be served')
    const pinned = await drawn(source, { pinned: 'ghost', force: true })
    expect(pinned.inbox).toEqual([])
    expect(pinned.problem).toBeNull()
  })
})

describe('DocumentSource: the documents it holds for a caller', () => {
  test('none before a read, then the sessions and the config last read', async () => {
    const { source } = rig()
    expect(source.sessionsRead).toBeNull()
    expect(source.settingsRead).toBeNull()
    await drawn(source)
    expect(source.sessionsRead?.self).toEqual({ team: 'shop', session: 'api' })
    expect(source.settingsRead?.kind).toBe('team')
  })

  test('each revision held by the name teamrig events gives it, none before a read or for a name it does not hold', async () => {
    const { source } = rig()
    expect(['tasks', 'sessions', 'config', 'plan', 'inbox'].map(name => source.heldRevision(name))).toEqual([null, null, null, null, null])
    await drawn(source)
    expect(['tasks', 'sessions', 'config', 'plan', 'inbox', 'stats'].map(name => source.heldRevision(name))).toEqual(['t1', 's1', 'c1', 'p1', 'i1', null])
  })

  test('the asker is the last run that answered: the session whose inbox it read, as the conversation', async () => {
    const { source } = rig()
    expect(source.asker).toBeNull()
    await drawn(source)
    expect(source.asker).toEqual({ session: 'api', conversation: 'c-1' })
  })

  test('a run that failed leaves the asker of the last one that answered', async () => {
    const { teamrig, files, source } = rig()
    await drawn(source)
    teamrig.broken = new Error('cannot start node')
    files.next = BASE
    await drawn(source, { claudeSession: 'c-2', force: true })
    expect(source.asker).toEqual({ session: 'api', conversation: 'c-1' })
  })

  test('a session retired since it was held leaves the asker naming none', async () => {
    const { teamrig, files, source } = rig()
    await drawn(source)
    teamrig.inboxes = {}
    teamrig.sessions = sessionsDocument('s2', { self: null, sessions: [session('lead', null), session('web', 'lead')] })
    files.next = BASE
    await drawn(source, { pinned: 'api' })
    expect(source.asker).toEqual({ session: null, conversation: 'c-1' })
  })
})

/** The ids of the plan a snapshot carries, in its order; null with no plan. */
function plannedIds(snapshot: Snapshot): string[] | null {
  return snapshot.plan?.tasks.map(planned => planned.id) ?? null
}

describe('DocumentSource: the plan', () => {
  test('a snapshot carries the plan last read, never one of the file fold', async () => {
    const { source } = rig({ ...BASE, plan: { at: NOW, validUntil: null, week: null, tasks: [], finished: [{ id: 'T9', workClass: 'Roadmap' }], ownerCards: null } })
    const snapshot = await drawn(source)
    expect(plannedIds(snapshot)).toEqual(['T1'])
    expect(snapshot.plan?.finished).toEqual([])
  })

  test('a teamrig that does not serve the plan still has its other documents drawn, under the reason', async () => {
    const { teamrig, source } = rig()
    teamrig.plan = null
    const first = await drawn(source)
    expect(teamrig.taken().map(asked => [asked.documents.join(' '), asked.session])).toEqual([
      ['tasks sessions config plan', null],
      ['tasks sessions config', null],
      ['inbox', 'api'],
    ])
    expect(titles(first)).toEqual(['T1 Title of T1', 'T2 Title of T2'])
    expect(first.inbox).toHaveLength(1)
    expect(first.problem).toBe(`REFUSED ${UNKNOWN_PLAN}`)
    expect(first.plan).toBeNull()
    const second = await drawn(source, { force: true })
    expect(teamrig.taken().map(asked => [asked.documents.join(' '), asked.session])).toEqual([
      ['tasks sessions config inbox plan', 'api'],
      ['tasks sessions config inbox', 'api'],
    ])
    expect(second.problem).toBe(`REFUSED ${UNKNOWN_PLAN}`)
  })

  test('once teamrig serves the plan it is read and the reason goes', async () => {
    const { teamrig, source } = rig()
    teamrig.plan = null
    await drawn(source)
    teamrig.plan = planDocument('p2', [planned('T2'), planned('T1')])
    const snapshot = await drawn(source, { force: true })
    expect(snapshot.problem).toBeNull()
    expect(plannedIds(snapshot)).toEqual(['T2', 'T1'])
  })

  test('a run that failed with the plan keeps the plan last held', async () => {
    const { teamrig, source } = rig()
    await drawn(source)
    teamrig.plan = null
    const snapshot = await drawn(source, { force: true })
    expect(snapshot.problem).toBe(`REFUSED ${UNKNOWN_PLAN}`)
    expect(plannedIds(snapshot)).toEqual(['T1'])
  })

  test('its revision is handed back until validUntil, and from that moment the plan is asked for whole', async () => {
    const { teamrig, source } = rig()
    teamrig.plan = planDocument('p1', [planned('T1')], { validUntil: new Date(NOW + HOUR).toISOString() })
    await drawn(source)
    teamrig.taken()
    await drawn(source, { now: NOW + HOUR - 1, force: true })
    expect(teamrig.taken().map(asked => asked.unless)).toEqual(['tasks=t1,sessions=s1,config=c1,inbox=i1,plan=p1'])
    teamrig.plan = planDocument('p1', [planned('T2')], { validUntil: null })
    const later = await drawn(source, { now: NOW + HOUR, force: true })
    expect(teamrig.taken().map(asked => asked.unless)).toEqual(['tasks=t1,sessions=s1,config=c1,inbox=i1'])
    expect(plannedIds(later)).toEqual(['T2'])
  })

  test('a plan that cannot be read keeps the one held and names why', async () => {
    const { teamrig, source } = rig()
    await drawn(source)
    teamrig.plan = { interface: '1.1', document: 'plan', revision: 'p2', problems: [] }
    const snapshot = await drawn(source, { force: true })
    expect(snapshot.problem).toContain("teamrig's plan document")
    expect(plannedIds(snapshot)).toEqual(['T1'])
  })
})

describe('titledCards', () => {
  const rows = rowsOf([task('T1'), task('T2')])

  test('takes each title from the rows, drops a card whose task they lack, and a session left with none', () => {
    const cards: PlanRead['ownerCards'] = [
      { session: 'api', due: ['T1', 'T9'], later: [{ id: 'T2', until: '2026-11-02', at: null }, { id: 'T8', until: '2026-11-03', at: null }] },
      { session: 'web', due: ['T9'], later: [] },
    ]
    expect(titledCards(cards, rows, TimeZone.UTC)).toEqual({ api: { due: [{ id: 'T1', title: 'Title of T1' }], later: [{ id: 'T2', title: 'Title of T2', until: 'Mon 11-02' }] } })
  })

  test("keeps the served order, and tells a put-off card's minute in the team's zone", () => {
    const cards: PlanRead['ownerCards'] = [{ session: 'api', due: [], later: [{ id: 'T2', until: '2026-10-13 15:00', at: null }, { id: 'T1', until: '2026-11-02', at: null }] }]
    expect(titledCards(cards, rows, TimeZone.UTC)['api']?.later.map(card => card.until)).toEqual(['10-13 15:00 UTC', 'Mon 11-02'])
  })

  test('draws no cards from a teamrig that serves none', () => {
    expect(titledCards(null, rows, TimeZone.UTC)).toEqual({})
  })

  test("a put-off card's time is drawn as data", () => {
    const cards: PlanRead['ownerCards'] = [{ session: 'api', due: [], later: [{ id: 'T1', until: 'Mon\u001b[2J', at: null }] }]
    expect(titledCards(cards, rows, TimeZone.UTC)['api']?.later[0]?.until).toBe(`Mon${CONTROL_SHOWN}[2J`)
  })
})
