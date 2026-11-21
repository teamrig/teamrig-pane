// A teamrig that answers `read` from a register's files, for the specs that run the whole pane (pane.test.ts): the
// pane draws its tasks, inbox, sessions and settings from `teamrig read` alone (T4742), so a test that writes a
// register's files needs a teamrig that serves them. It finds the team as the pane does (hooks/places.ts), folds the
// register with the pane's own fold (hooks/source.ts) and prints each document as interface 1.1 serves it: 1.0's
// four in a 1.0 envelope, and the `plan` (served-plan.ts) in a 1.1 one, judged at the fake's clock. Its
// `sessions` document is the tree of the kit home's team folders that holds the team (served-sessions.ts), each
// team's sessions from its config, rename log and hire log, the asking team's with their unread inbox lines. What it
// does not do as teamrig does: a session's row carries no state, ask, host or conversation, and a peer team's no
// unread count; the inbox is the day's lines and the unread ones, as the fold windows them; a team folder it cannot
// read fails the run instead of being named; a revision is the hash of the document's own text, the plan's too, so
// a plan the clock alone turned has a new revision here, where teamrig's covers the files only.
import { indexMarks, inboxLines, parseConfigText, readHiringLog, readMarks, readRenames, Roster, unreadOf, type KitConfig } from '../hooks/core/read/index'
import { lineHash } from '../hooks/line-hash'
import { findPlaces, kitHomeOf, teamIds, teamStateDir, type PlacesInput, type TeamFiles } from '../hooks/places'
import type { DocumentName, JsonRecord } from '../hooks/read-document'
import { registerPaths, TaskRegisterSource, type Files, type RegisterDirs } from '../hooks/source'
import type { CliRun } from '../hooks/teamrig-cli'
import type { Snapshot, TaskRow, TeamSettings } from '../types'
import { NO_TREE_GOALS } from './fixtures'
import { askedOf, printed, refused, settingRows, type Asked } from './served-documents'
import { servedPlan } from './served-plan'
import { servedSessions, type TeamSessions } from './served-sessions'

/**
 * Where the fake finds the register: what the pane's own search takes, over files the fold can read, and `folders`,
 * the names of the folders right under a folder (none when it is not there), which name the machine's teams.
 */
export type FakeDisk = Omit<PlacesInput, 'files'> & { readonly files: Files; readonly folders: (path: string) => Promise<string[]> }

/** One run of the fake: the words after `node <main>`, or the whole argv. */
export type FakeRead = (argv: readonly string[]) => Promise<CliRun>

/** Why a run serves nothing, as teamrig's `REFUSED` line tells it. */
class Refusal extends Error {}

type Team = { readonly files: TeamFiles; readonly dirs: RegisterDirs; readonly settings: TeamSettings; readonly config: KitConfig; readonly roster: Roster }

/** The team's config and names, read from its folder; a team whose config cannot be read serves nothing. */
async function teamOf(disk: FakeDisk, files: TeamFiles, dirs: RegisterDirs, settings: TeamSettings): Promise<Team> {
  if ((await disk.files.stamp(files.config)) === null) throw new Refusal(`team ${files.team} has no config`)
  const read = parseConfigText(await disk.files.read(files.config))
  if (read.status !== 'loaded') throw new Refusal(`team ${files.team}'s config cannot be read`)
  const renames = (await disk.files.stamp(files.renames)) === null ? [] : readRenames(await disk.files.read(files.renames)).renames
  return { files, dirs, settings, config: read.config, roster: new Roster(read.config, files.team, renames) }
}

/** The register as the pane's fold reads it now, for `conversation`, or tied to `pinned`. */
async function foldOf(disk: FakeDisk, team: Team, pinned: string | null, conversation: string | null, now: number): Promise<Snapshot> {
  const source = new TaskRegisterSource(disk.files, registerPaths(team.dirs), team.settings, team.files, NO_TREE_GOALS)
  const snapshot = await source.poll({ claudeSession: conversation ?? '', pinned, now, force: true })
  if (snapshot === null) throw new Refusal(`team ${team.files.team}'s register cannot be read`)
  return snapshot
}

/** The fake's one tracker, named as teamrig's GitHub connector names itself (teamrig's src/github/connector.ts). */
const GITHUB = { id: 'github', name: 'GitHub' }
/** A ref that connector knows as an issue: `gh:<owner>/<repo>#<number>`. */
const GITHUB_REF = /^gh:([\w.-]+\/[\w.-]+)#([1-9]\d*)$/

/** A ref as the `tasks` document serves it: its text, and the issue's connector, id, label and page when it names one. */
function servedRef(ref: string): JsonRecord {
  const [, repo, number] = GITHUB_REF.exec(ref) ?? []
  if (repo === undefined || number === undefined) return { text: ref, connector: null, id: null, label: null, url: null }
  const id = `${repo}#${number}`
  return { text: ref, connector: GITHUB, id, label: { text: id, source: 'outside' }, url: `https://github.com/${repo}/issues/${number}` }
}

/** A source as the `tasks` document serves it: the owner's marker first, then the tracker, any other a session's. */
function servedSource(source: string, team: Team): JsonRecord {
  if (source === team.settings.ownerSource) return { kind: 'owner', id: source, name: source }
  if (source === GITHUB.id) return { kind: 'connector', ...GITHUB }
  return { kind: 'session', id: source, name: team.roster.nameOf(source) ?? source }
}

/** A task as the `tasks` document serves it: the fold's row, its texts marked as the team's, its source and ref as data. */
function servedTask(row: TaskRow, team: Team): JsonRecord {
  const { descriptionCut: _notServed, item: _servedInRef, isImported: _servedInSource, title, description, source, ref, ...served } = row
  return {
    ...served,
    title: { text: title, source: 'team' },
    description: description === null ? null : { text: description, source: 'team' },
    source: servedSource(source, team),
    ref: ref === null ? null : servedRef(ref),
  }
}

/** A file's text; null when it is not there. */
async function textOf(files: Files, path: string): Promise<string | null> {
  return (await files.stamp(path)) === null ? null : await files.read(path)
}

/** The unread inbox lines of each of the team's sessions that ever marked its inbox read, by id, as teamrig counts them. */
async function unreadCounts(disk: FakeDisk, team: Team): Promise<ReadonlyMap<string, number>> {
  const paths = registerPaths(team.dirs)
  const marks = await textOf(disk.files, paths.marks)
  const { byArea } = indexMarks(marks === null ? [] : readMarks(marks).marks)
  const counts = new Map<string, number>()
  for (const id of team.config.sessions) {
    const mark = byArea.get(id)
    if (mark === undefined) continue
    const inbox = await textOf(disk.files, `${paths.inboxDir}/${id}.md`)
    counts.set(id, unreadOf(id, inbox === null ? [] : inboxLines(inbox), mark, lineHash).lines.length)
  }
  return counts
}

/**
 * Every team in the kit home's teams folder whose config teamrig takes, as its files say: its config and, in the
 * state folder that names, its rename and hire logs; the asking team's unread counts with it.
 */
async function machineTeams(disk: FakeDisk, own: Team): Promise<TeamSessions[]> {
  const { teamsDir } = own.files
  const teams: TeamSessions[] = []
  for (const id of teamIds(await disk.folders(teamsDir))) {
    const home = `${teamsDir}/${id}`
    const text = await textOf(disk.files, `${home}/config.json`)
    const read = text === null ? null : parseConfigText(text)
    if (read?.status !== 'loaded') continue
    const state = teamStateDir(home, read.config)
    const renames = await textOf(disk.files, `${state}/renames.jsonl`)
    const hires = await textOf(disk.files, `${state}/hires.jsonl`)
    teams.push({
      team: id,
      config: read.config,
      renames: renames === null ? [] : readRenames(renames).renames,
      hires: hires === null ? [] : readHiringLog(hires).records,
      unread: id === own.files.team ? await unreadCounts(disk, own) : null,
    })
  }
  return teams
}

/** Each config key the pane draws with, at the value the team's settings hold. */
function servedSettings(settings: TeamSettings): (readonly [string, unknown])[] {
  const { focus } = settings
  const { score, expedite } = focus
  return [
    ['register.ownerSource', settings.ownerSource],
    ['register.requireDecisionCard', settings.requireDecisionCard],
    ['register.check.notPickedUpAfterHours', settings.notPickedUpAfterHours],
    ['focus.defaultClass', focus.defaultClass],
    ['focus.roadmapClass', focus.roadmapClass],
    ['focus.maintenanceClass', focus.maintenanceClass],
    ['focus.parkAfterDays', focus.parkAfterDays],
    ['focus.score.rankValues', score.rankValues],
    ['focus.score.roadmapUnranked', score.roadmapUnranked],
    ['focus.score.maintenanceValue', score.maintenanceValue],
    ['focus.score.maintenanceBug', score.maintenanceBug],
    ['focus.score.maintenanceCritical', score.maintenanceCritical],
    ['focus.score.improvementsValue', score.improvementsValue],
    ['focus.score.overdueValue', score.overdueValue],
    ['focus.score.dueSoonValue', score.dueSoonValue],
    ['focus.score.dueSoonDays', score.dueSoonDays],
    ['focus.score.unblocksShare', score.unblocksShare],
    ['focus.score.ownerOrderValues', score.ownerOrderValues],
    ['focus.score.defaultSizePct', score.defaultSizePct],
    ['focus.score.minSizePct', score.minSizePct],
    ['focus.expedite.critical', expedite.critical],
    ['focus.expedite.ownerP1', expedite.ownerP1],
  ]
}

/** The session whose inbox is served: one the team has now, by id or by a name it has had; any other refuses the run. */
function inboxSession(team: Team, asker: string | null): string {
  if (asker === null) throw new Refusal('inbox needs --session')
  const found = team.roster.lookup(asker)
  if (!found.ok) throw new Refusal(found.error)
  return found.id
}

/** The documents this fake serves: every one the pane knows by name, which are interface 1.1's. */
const SERVED_NAMES: readonly DocumentName[] = ['tasks', 'inbox', 'sessions', 'config', 'plan']

function isServedName(value: string): value is DocumentName {
  return SERVED_NAMES.some(name => name === value)
}

/** What one document of a team says, without its envelope; the plan without its `at`, which the envelope's clock adds. */
async function teamBody(name: DocumentName, disk: FakeDisk, team: Team, asked: Asked, now: number): Promise<JsonRecord> {
  switch (name) {
    case 'plan':
      return servedPlan(await foldOf(disk, team, null, asked.conversation, now))
    case 'tasks': {
      const fold = await foldOf(disk, team, null, asked.conversation, now)
      return { tasks: fold.tasks.map(row => servedTask(row, team)) }
    }
    case 'sessions': {
      const area = asked.conversation === null ? null : (await foldOf(disk, team, null, asked.conversation, now)).area
      const self = area === null || !team.roster.ids.includes(area) ? null : { team: team.files.team, session: area }
      return servedSessions(await machineTeams(disk, team), team.files.team, self)
    }
    case 'inbox': {
      const id = inboxSession(team, asked.session)
      const fold = await foldOf(disk, team, id, asked.conversation, now)
      return {
        session: { id, name: team.roster.nameOf(id) ?? id },
        unread: fold.unreadInbox,
        lines: fold.inbox.map(line => ({ ...line, at: new Date(line.at).toISOString(), text: { text: line.text, source: 'team' } })),
      }
    }
    case 'config':
      return { team: team.files.team, teams: [], timeZone: team.settings.timeZone, settings: settingRows(servedSettings(team.settings)) }
  }
}

/** With no team only the `config` document is served: the machine's teams to join one of; any other refuses the run. */
async function teamlessBody(name: DocumentName, disk: FakeDisk): Promise<JsonRecord> {
  if (name !== 'config') throw new Refusal(`no team here: ${name} needs one`)
  const kit = kitHomeOf(disk.env, disk.home)
  const teams = kit === null ? [] : teamIds(await disk.folders(`${kit}/teams`))
  return { team: null, teams, timeZone: disk.machineZone, settings: [] }
}

/** The revision each document was asked `--unless` it is at (`tasks=<revision>,inbox=<revision>`). */
function heldOf(unless: string | null): ReadonlyMap<string, string> {
  const held = new Map<string, string>()
  for (const entry of unless === null ? [] : unless.split(',')) {
    const [name, revision] = entry.split('=')
    if (name !== undefined && revision !== undefined) held.set(name, revision)
  }
  return held
}

/**
 * The document as it is printed at `now`: `unchanged` alone when the asker holds its revision, else the body in its
 * envelope. The plan comes as interface 1.1 serves it, with when it was judged and no `cuts`; its revision is taken
 * before that time is added, or every read of it would be a changed one.
 */
function enveloped(name: DocumentName, body: JsonRecord, held: string | undefined, now: number): JsonRecord {
  const revision = lineHash(JSON.stringify(body))
  const version = name === 'plan' ? '1.1' : '1.0'
  if (held === revision) return { interface: version, document: name, revision, unchanged: true }
  if (name === 'plan') return { interface: version, document: name, revision, problems: [], at: new Date(now).toISOString(), ...body }
  return { interface: version, document: name, revision, problems: [], ...body, cuts: [] }
}

async function answer(disk: FakeDisk, asked: Asked, now: number): Promise<CliRun> {
  const names = asked.documents.filter(isServedName)
  if (names.length === 0 || names.length !== asked.documents.length) throw new Refusal(`read serves ${SERVED_NAMES.join(', ')}`)
  const places = await findPlaces(disk)
  if (places.kind === 'problem') throw new Refusal(places.problem)
  const team = places.kind === 'found' && places.team !== null ? await teamOf(disk, places.team, places.dirs, places.settings) : null
  const held = heldOf(asked.unless)
  const documents: JsonRecord[] = []
  for (const name of names) {
    const body = team === null ? await teamlessBody(name, disk) : await teamBody(name, disk, team, asked, now)
    documents.push(enveloped(name, body, held.get(name), now))
  }
  return printed(...documents)
}

/**
 * A teamrig answering `read <documents> --json [--unless ...] [--session ...] [--conversation ...]` from the files
 * of `disk` at `now()`: a line per document asked, or, as teamrig does, nothing but a `REFUSED` line when any of
 * them cannot be served.
 */
export function fakeRead(disk: FakeDisk, now: () => number): FakeRead {
  return async argv => {
    try {
      return await answer(disk, askedOf(argv), now())
    } catch (error) {
      if (error instanceof Refusal) return refused(error.message)
      throw error
    }
  }
}
