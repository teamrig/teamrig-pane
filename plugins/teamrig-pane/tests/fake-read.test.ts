// The fake teamrig the whole-pane specs read through (tests/fake-read.ts): that each document it prints from a
// register's files is one the pane's own readers take whole, saying what the pane's fold of those files says; whom
// it serves an inbox; what a held revision answers; what it refuses, a run at a time (T4742); and that its plan is
// the pane's own tree of the fold, served as interface 1.1 does (T4759).
import { describe, expect, test } from 'claude-code/testing'
import { configOf } from '../hooks/config-document'
import type { BodyRead } from '../hooks/document-fields'
import { inboxOf } from '../hooks/inbox-document'
import { treeOf } from '../hooks/meta'
import { findPlaces } from '../hooks/places'
import { planOf } from '../hooks/plan-document'
import { readAnswer, type DocumentName, type ReadDocument } from '../hooks/read-document'
import { sessionsOf } from '../hooks/sessions-document'
import { registerPaths, TaskRegisterSource } from '../hooks/source'
import { tasksOf } from '../hooks/tasks-document'
import type { CliRun } from '../hooks/teamrig-cli'
import type { Snapshot } from '../types'
import { fakeRead, type FakeDisk } from './fake-read'
import { HOUR, INBOX_LINES, MemoryFiles, NO_TREE_GOALS, NOW, S1, S2, TEAM_SETTINGS, createLine, iso, markLine, statusLine, waitingLine } from './fixtures'
import { hire, retire } from './team-fixtures'

const HOME = '/Homes/tester'
const TEAMS = `${HOME}/.teamrig/teams`
const STATE = `${TEAMS}/web/state`
const PATHS = registerPaths({ tasksDir: STATE, inboxDir: `${STATE}/inbox` })

const CONFIG = {
  team: { id: 'web' },
  sessions: ['lead', 'po', 'api', 'ui'],
  names: { api: 'backend' },
  roles: { lead: 'lead' },
  leads: { po: ['api'] },
}

const EVENTS = [
  createLine('T1', { at: NOW - 5 * HOUR, by: 'lead', owner: 'po', title: 'Plan the page', description: 'What it is for' }),
  statusLine('T1', 'po', NOW - 4 * HOUR, 'in-progress'),
  createLine('T2', { at: NOW - 3 * HOUR, by: 'po', owner: 'api', title: 'Add the route', source: 'po', ref: null }),
]

/** Team web's files: the session started in /work is po's (its `inbox read` mark names S1), three inbox lines read. */
function teamDisk(): { files: MemoryFiles; disk: FakeDisk } {
  const files = new MemoryFiles()
  files.write('/work/.teamrig.json', JSON.stringify({ team: 'web' }))
  files.write(`${TEAMS}/web/config.json`, JSON.stringify(CONFIG))
  files.write(PATHS.events, EVENTS.join('\n'))
  files.write(PATHS.marks, markLine('po', 3, S1, NOW - HOUR, INBOX_LINES[2] ?? null))
  files.write(`${PATHS.inboxDir}/po.md`, INBOX_LINES.join('\n'))
  return { files, disk: diskOf(files, '/work') }
}

function diskOf(files: MemoryFiles, cwd: string): FakeDisk {
  return { env: {}, files, folders: async path => (path === TEAMS ? ['web', 'ops'] : []), home: HOME, cwd, machineZone: 'UTC' }
}

/** The pane's own fold of the team's files, tied to `pinned`. */
async function foldOf(files: MemoryFiles, pinned: string | null): Promise<Snapshot> {
  const snapshot = await new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null, NO_TREE_GOALS).poll({ claudeSession: S1, pinned, now: NOW, force: true })
  if (snapshot === null) throw new Error('the fold read nothing')
  return snapshot
}

function documentOf(run: CliRun, name: DocumentName): ReadDocument {
  const answer = readAnswer(run.stdout)
  const document = answer.documents.find(one => one.name === name)
  if (document === undefined) throw new Error(`no ${name} document: exit ${run.exitCode} ${run.stderr} ${answer.unreadable.join('; ')}`)
  return document
}

/** What the pane's reader makes of the `name` document of `run`, with nothing left out of it. */
function readOf<T>(run: CliRun, name: DocumentName, reader: (document: ReadDocument) => BodyRead<T>): T {
  const read = reader(documentOf(run, name))
  if (read.kind !== 'read') throw new Error(read.reason)
  expect(read.problems).toEqual([])
  return read.value
}

function words(documents: string, ...flags: string[]): string[] {
  return ['read', ...documents.split(' '), '--json', ...flags]
}

describe('the fake teamrig read', () => {
  test('serves the tasks the fold holds, each as a row the tasks reader takes whole', async () => {
    const { files, disk } = teamDisk()
    const run = await fakeRead(disk, () => NOW)(words('tasks', '--conversation', S1))
    const rows = readOf(run, 'tasks', tasksOf)
    expect(rows).toEqual((await foldOf(files, null)).tasks.map(row => ({ ...row, descriptionCut: null })))
    expect(rows.map(row => [row.id, row.title, row.description, row.status, row.source, row.ref])).toEqual([
      ['T1', 'Plan the page', 'What it is for', 'in-progress', 'owner', 'docs/x.md'],
      ['T2', 'Add the route', null, 'open', 'po', null],
    ])
  })

  test("serves a source as the owner's, a session's or the tracker's, and an issue ref with its item, as teamrig's GitHub connector does", async () => {
    const { files, disk } = teamDisk()
    files.write(
      PATHS.events,
      [
        ...EVENTS,
        createLine('T3', { at: NOW - 2 * HOUR, by: 'github', owner: 'api', source: 'github', ref: 'gh:acme/app#12' }),
        createLine('T4', { at: NOW - HOUR, by: 'lead', owner: 'api', source: 'gone', ref: 'gh:acme/app#7; docs/x.md:3' }),
      ].join('\n'),
    )
    const run = await fakeRead(disk, () => NOW)(words('tasks', '--conversation', S1))
    const served = documentOf(run, 'tasks').fields['tasks']
    expect(served).toMatchObject([
      { source: { kind: 'owner', id: 'owner', name: 'owner' } },
      { source: { kind: 'session', id: 'po', name: 'web-po' }, ref: null },
      {
        source: { kind: 'connector', id: 'github', name: 'GitHub' },
        ref: { text: 'gh:acme/app#12', connector: { id: 'github', name: 'GitHub' }, id: 'acme/app#12', label: { text: 'acme/app#12', source: 'outside' }, url: 'https://github.com/acme/app/issues/12' },
      },
      { source: { kind: 'session', id: 'gone', name: 'gone' }, ref: { text: 'gh:acme/app#7; docs/x.md:3', connector: null, id: null, label: null, url: null } },
    ])
    const rows = readOf(run, 'tasks', tasksOf)
    expect(rows.map(row => [row.id, row.isImported, row.item])).toEqual([
      ['T1', false, null],
      ['T2', false, null],
      ['T3', true, { tracker: 'GitHub', id: 'acme/app#12', url: 'https://github.com/acme/app/issues/12' }],
      ['T4', false, null],
    ])
  })

  test('takes the whole argv of a run, the node and main words too', async () => {
    const { disk } = teamDisk()
    const run = await fakeRead(disk, () => NOW)(['node', 'K/teamrig/dist/cli/main.js', ...words('tasks')])
    expect(readOf(run, 'tasks', tasksOf).length).toBe(2)
  })

  test("serves the config's sessions under their names and leaders, and the conversation's own session", async () => {
    const { disk } = teamDisk()
    const read = readOf(await fakeRead(disk, () => NOW)(words('sessions', '--conversation', S1)), 'sessions', sessionsOf)
    expect(read.self).toEqual({ team: 'web', session: 'po' })
    expect(read.teams).toEqual([{ id: 'web', parent: null, active: 4, retired: 0 }])
    expect(read.failures).toEqual([])
    expect(read.sessions.map(row => [row.id, row.name, row.leader, row.ledBy, row.leads, row.roles])).toEqual([
      ['lead', 'web-lead', null, [], 2, ['lead']],
      ['po', 'web-po', 'lead', ['lead'], 1, []],
      ['api', 'backend', 'po', ['po', 'lead'], 0, []],
      ['ui', 'web-ui', 'lead', ['lead'], 0, []],
    ])
  })

  test("serves the tree of team folders that holds the team: each session's launch, hire and retire from its team's logs, the asking team's unread lines, and no other project's team", async () => {
    const { files } = teamDisk()
    const disk: FakeDisk = { ...diskOf(files, '/work'), folders: async path => (path === TEAMS ? ['web', 'tools', 'other', 'empty'] : []) }
    files.write(`${TEAMS}/web/config.json`, JSON.stringify({ ...CONFIG, launch: { ui: { model: 'claude-opus-5-5', effort: 'xhigh' } } }))
    const hires = [hire('ui', NOW - 96 * HOUR), hire('qa', NOW - 90 * HOUR), retire('qa', NOW - 60 * HOUR)]
    files.write(`${STATE}/hires.jsonl`, hires.map(record => JSON.stringify({ v: 2, ...record, at: iso(record.at) })).join('\n'))
    files.write(`${TEAMS}/tools/config.json`, JSON.stringify({ team: { id: 'tools', parent: 'web' }, sessions: ['boss'], roles: { lead: 'boss' } }))
    files.write(`${TEAMS}/other/config.json`, JSON.stringify({ team: { id: 'other' }, sessions: ['lead'], roles: { lead: 'lead' } }))

    const read = readOf(await fakeRead(disk, () => NOW)(words('sessions', '--conversation', S1)), 'sessions', sessionsOf)
    expect(read.teams).toEqual([
      { id: 'web', parent: null, active: 4, retired: 1 },
      { id: 'tools', parent: 'web', active: 1, retired: 0 },
    ])
    expect(read.sessions.map(row => [row.team, row.id, row.active, row.unread, row.hire?.by ?? null, row.retire?.by ?? null])).toEqual([
      ['web', 'lead', true, null, null, null],
      // po read 3 of its 5 inbox lines (teamDisk); the others never marked theirs read.
      ['web', 'po', true, 2, null, null],
      ['web', 'api', true, null, null, null],
      ['web', 'ui', true, null, 'lead', null],
      ['web', 'qa', false, null, null, 'lead'],
      ['tools', 'boss', true, null, null, null],
    ])
    const launches = new Map(read.sessions.map(row => [`${row.team}/${row.id}`, row.launch]))
    expect(launches.get('web/ui')).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(launches.get('web/qa')).toBeNull()
    // A team below the asking one is served without its own words.
    expect(launches.get('tools/boss')?.text).toBeNull()
  })

  test('names no session of its own for a conversation no mark names, or for a run that names none', async () => {
    const { disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    expect(readOf(await teamrig(words('sessions', '--conversation', S2)), 'sessions', sessionsOf).self).toBe(null)
    expect(readOf(await teamrig(words('sessions')), 'sessions', sessionsOf).self).toBe(null)
  })

  test("serves the asked session's inbox as the fold windows it, by id or by name", async () => {
    const { files, disk } = teamDisk()
    files.write(`${PATHS.inboxDir}/api.md`, '- 2026-10-13 13:30 po: one for the backend')
    const teamrig = fakeRead(disk, () => NOW)
    const fold = await foldOf(files, 'po')
    const read = readOf(await teamrig(words('inbox', '--session', 'po', '--conversation', S1)), 'inbox', inboxOf)
    expect(read.session).toEqual({ id: 'po', name: 'web-po' })
    expect(read.unread).toBe(2)
    expect(read.unread).toBe(fold.unreadInbox)
    expect(read.items).toEqual(fold.inbox)
    const named = readOf(await teamrig(words('inbox', '--session', 'backend')), 'inbox', inboxOf)
    expect(named.session).toEqual({ id: 'api', name: 'backend' })
    expect(named.items.map(item => [item.from, item.text])).toEqual([['po', 'one for the backend']])
  })

  test('serves the settings the pane found in the team config', async () => {
    const { files, disk } = teamDisk()
    files.write(`${TEAMS}/web/config.json`, JSON.stringify({ ...CONFIG, timeZone: 'Asia/Jerusalem', register: { ownerSource: 'boss' } }))
    const places = await findPlaces(disk)
    if (places.kind !== 'found') throw new Error(`no team found: ${places.kind}`)
    const read = readOf(await fakeRead(disk, () => NOW)(words('config')), 'config', configOf)
    if (read.kind !== 'team') throw new Error(`no team served: ${read.kind}`)
    expect(read.team).toBe('web')
    // The document serves only the settings the pane draws with; the found focus also holds the rest of the config's.
    expect(places.settings).toMatchObject(read.settings)
    expect([places.settings.timeZone, places.settings.ownerSource]).toEqual(['Asia/Jerusalem', 'boss'])
  })

  test('prints a line per document asked, in the order asked', async () => {
    const { disk } = teamDisk()
    const run = await fakeRead(disk, () => NOW)(words('config sessions tasks inbox', '--session', 'po', '--conversation', S1))
    expect(run.exitCode).toBe(0)
    expect(readAnswer(run.stdout).documents.map(document => document.name)).toEqual(['config', 'sessions', 'tasks', 'inbox'])
  })

  test('answers unchanged for a document asked with the revision it is at, and the document once its files moved', async () => {
    const { files, disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    const first = await teamrig(words('tasks config'))
    const [tasks, config] = [documentOf(first, 'tasks').revision, documentOf(first, 'config').revision]
    const again = await teamrig(words('tasks config', '--unless', `tasks=${tasks},config=${config}`))
    expect(readAnswer(again.stdout).documents.map(document => [document.name, document.isUnchanged, document.revision])).toEqual([
      ['tasks', true, tasks],
      ['config', true, config],
    ])
    files.write(PATHS.events, [...EVENTS, statusLine('T2', 'api', NOW - HOUR, 'in-progress')].join('\n'))
    const moved = await teamrig(words('tasks config', '--unless', `tasks=${tasks},config=${config}`))
    expect(documentOf(moved, 'config').isUnchanged).toBe(true)
    expect(documentOf(moved, 'tasks').isUnchanged).toBe(false)
    expect(documentOf(moved, 'tasks').revision === tasks).toBe(false)
    expect(readOf(moved, 'tasks', tasksOf).map(row => row.status)).toEqual(['in-progress', 'in-progress'])
  })

  test('refuses the whole run for an inbox of a session the config does not hold, or of none', async () => {
    const { disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    const other = await teamrig(words('tasks inbox', '--session', 'qa'))
    expect([other.exitCode, other.stdout]).toEqual([2, ''])
    expect(other.stderr.startsWith('REFUSED ')).toBe(true)
    expect(await teamrig(words('tasks inbox'))).toEqual({ exitCode: 2, stdout: '', stderr: 'REFUSED inbox needs --session', isStdoutTruncated: false })
  })

  test('refuses a run that asks no document, or one it does not serve', async () => {
    const { disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    const refusal = { exitCode: 2, stdout: '', stderr: 'REFUSED read serves tasks, inbox, sessions, config, plan', isStdoutTruncated: false }
    expect(await teamrig(words('tasks goals'))).toEqual(refusal)
    expect(await teamrig(['read', '--json'])).toEqual(refusal)
  })

  test("serves the plan as interface 1.1 does: the active tasks in the pane's own plan order, the finished ones by their class", async () => {
    const { files, disk } = teamDisk()
    files.write(
      PATHS.events,
      [
        ...EVENTS,
        createLine('T3', { at: NOW - 2 * HOUR, by: 'lead', owner: 'api' }),
        statusLine('T3', 'api', NOW - HOUR, 'done'),
        createLine('T4', { at: NOW - 2 * HOUR, by: 'lead', owner: 'ui', priority: 1, due: '2026-10-20' }),
      ].join('\n'),
    )
    const run = await fakeRead(disk, () => NOW)(words('tasks plan', '--conversation', S1))
    const document = documentOf(run, 'plan')
    expect([document.interface, 'cuts' in document.fields]).toEqual([{ major: 1, minor: 1 }, false])
    const plan = readOf(run, 'plan', planOf)
    const fold = await foldOf(files, null)
    const tree = treeOf(fold)
    const active = tree.inPlanOrder(fold.tasks.filter(task => task.status !== 'done'))
    expect(active.length).toBe(3)
    expect(plan.at).toBe(NOW)
    expect(plan.week).toBe(tree.week)
    expect(plan.tasks.map(task => task.id)).toEqual(active.map(task => task.id))
    expect(plan.tasks.map(task => [task.id, task.started, task.parked, task.ready])).toEqual(active.map(task => [task.id, task.status === 'in-progress', false, true]))
    expect(plan.tasks.map(task => [task.score, task.workClass])).toEqual(active.map(task => [tree.rankedOf(task)?.score, tree.rankedOf(task)?.workClass]))
    expect(plan.tasks.find(task => task.id === 'T4')?.due).toEqual({ due: '2026-10-20', at: tree.dueTime({ id: 'T4', due: '2026-10-20' }), from: null })
    expect(plan.tasks.find(task => task.id === 'T1')?.next).toEqual({ kind: 'work', who: 'po', task: 'T1', behind: null })
    const finished = fold.tasks.filter(task => task.status === 'done')
    expect(finished.map(task => task.id)).toEqual(['T3'])
    expect(plan.finished).toEqual(finished.map(task => ({ id: task.id, workClass: tree.rankedOf(task)?.workClass })))
  })

  test('serves what a task needs, who needs it and who moves next, a need no register holds as a finished one', async () => {
    const { files, disk } = teamDisk()
    files.write(
      PATHS.events,
      [...EVENTS, waitingLine('T2', 'api', NOW - HOUR, [{ kind: 'task', id: 'T1' }, { kind: 'task', id: 'T99' }, { kind: 'time', at: '2026-10-13 16:00' }])].join('\n'),
    )
    const plan = readOf(await fakeRead(disk, () => NOW)(words('plan')), 'plan', planOf)
    const [t1, t2] = ['T1', 'T2'].map(id => plan.tasks.find(task => task.id === id))
    expect(t2?.ready).toBe(false)
    expect(t2?.needs).toEqual([
      { id: 'T1', team: null, owner: 'po', status: 'in-progress' },
      { id: 'T99', team: null, owner: null, status: null },
    ])
    expect(t2?.next).toEqual({ kind: 'work', who: 'po', task: 'T1', behind: null })
    expect(t1?.neededBy).toEqual([{ id: 'T2', owner: 'api', due: null }])
    expect(t1?.unblocks).toEqual({ first: 'T2', priority: 3, count: 1 })
    // The time T2 waits until is the first moment an answer turns with no file moving.
    expect(plan.validUntil).toBe(NOW + 2 * HOUR)
  })

  test('serves the time a waiting task comes back to its owner, as a moment', async () => {
    const { files, disk } = teamDisk()
    files.write(PATHS.events, [...EVENTS, waitingLine('T2', 'api', NOW - HOUR, [{ kind: 'time', at: '2026-10-13 16:00' }])].join('\n'))
    const plan = readOf(await fakeRead(disk, () => NOW)(words('plan')), 'plan', planOf)
    expect(plan.tasks.find(task => task.id === 'T2')?.next).toEqual({ kind: 'time', who: 'api', task: 'T2', behind: null, at: NOW + 2 * HOUR })
  })

  test('answers a held plan revision with unchanged while only the clock moved, and serves it again once the register did', async () => {
    const { files, disk } = teamDisk()
    let now = NOW
    const teamrig = fakeRead(disk, () => now)
    const revision = documentOf(await teamrig(words('plan')), 'plan').revision
    now = NOW + HOUR
    const later = documentOf(await teamrig(words('plan', '--unless', `plan=${revision}`)), 'plan')
    expect([later.isUnchanged, later.revision, later.interface]).toEqual([true, revision, { major: 1, minor: 1 }])
    files.write(PATHS.events, [...EVENTS, statusLine('T2', 'api', NOW, 'in-progress')].join('\n'))
    const moved = await teamrig(words('plan', '--unless', `plan=${revision}`))
    expect(documentOf(moved, 'plan').isUnchanged).toBe(false)
    expect(readOf(moved, 'plan', planOf).at).toBe(NOW + HOUR)
  })

  test('refuses the plan where there is no team, as every document but config', async () => {
    const files = new MemoryFiles()
    const run = await fakeRead(diskOf(files, '/elsewhere'), () => NOW)(words('config plan'))
    expect(run).toEqual({ exitCode: 2, stdout: '', stderr: 'REFUSED no team here: plan needs one', isStdoutTruncated: false })
  })

  test("refuses every document of a team whose config is missing or cannot be read, and tells the pane's own problem", async () => {
    const { files, disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    files.remove(`${TEAMS}/web/config.json`)
    expect((await teamrig(words('config'))).stderr).toBe('REFUSED team web has no config')
    files.write(`${TEAMS}/web/config.json`, '{ no json')
    const places = await findPlaces(disk)
    if (places.kind !== 'problem') throw new Error(`a broken config is no problem: ${places.kind}`)
    expect((await teamrig(words('config'))).stderr).toBe(`REFUSED ${places.problem}`)
  })

  test('with no team serves the config document alone: the teams of the machine, and no setting', async () => {
    const files = new MemoryFiles()
    const disk = diskOf(files, '/elsewhere')
    const places = await findPlaces(disk)
    if (places.kind !== 'unset') throw new Error(`a team or a problem was found: ${places.kind}`)
    const teamrig = fakeRead(disk, () => NOW)
    // The kit home's folders that name a team, sorted.
    expect(readOf(await teamrig(words('config')), 'config', configOf)).toEqual({ kind: 'no-team', teams: ['ops', 'web'], timeZone: 'UTC' })
    expect(await teamrig(words('config tasks'))).toEqual({ exitCode: 2, stdout: '', stderr: 'REFUSED no team here: tasks needs one', isStdoutTruncated: false })
  })

  test('refuses the run with the problem the pane itself would show for a file it cannot read', async () => {
    const { files, disk } = teamDisk()
    files.failNextRead = 'EBUSY: the disk is locked'
    const run = await fakeRead(disk, () => NOW)(words('tasks'))
    expect([run.exitCode, run.stdout]).toEqual([2, ''])
    expect(run.stderr).toBe('REFUSED /work/.teamrig.json cannot be read (EBUSY: the disk is locked)')
  })
})
