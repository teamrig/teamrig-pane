// The dedicated UI's team: the register the dock binds at a session's start (hooks/register.tsx `bind`), on ports a
// process gives instead of the engine's `$`. It finds the team as the dock does (places.ts), reads the tasks, inbox,
// sessions and settings through `teamrig read` (document-source.ts) at the refresher's tick (refresher.ts; the UI
// follows no event stream yet), and writes each snapshot to the store, which draws it. teamrig starts the UI as `node <entry> --team <team> [--session <id>]` with its CLI's
// script and its Node.js in the environment (teamrig's src/ui/start.ts), so the UI calls back the teamrig that
// started it. It is not a Claude Code conversation: the area it draws is the `--session` named, else the
// environment's TEAMRIG_SESSION, else the session the person last typed in (last-typed.ts, T5101), else the one
// teamrig finds for the asker. Runs the CLI and reads files only.
import { NO_FEED } from '../hooks/change-feed'
import { SESSION_NAME } from '../hooks/core/read/index'
import { TaskDetails, type RefPlaces } from '../hooks/details'
import { DocumentSource } from '../hooks/document-source'
import { messageOf } from '../hooks/errors'
import { LiveRegister, POLL_MS, type LivePorts, type Timer } from '../hooks/live'
import type { PaneStore } from '../hooks/pane-store'
import { findPlaces, kitHomeOf, TEAMRIG_ENV, type Places, type PlacesEnv } from '../hooks/places'
import type { ReadsFile } from '../hooks/presses'
import { RefFileReader } from '../hooks/ref-file'
import { Refresher } from '../hooks/refresher'
import { FollowedAsker, registerSubject, type HeldDocuments } from '../hooks/register-subject'
import { registerPaths, TaskRegisterSource, type Files } from '../hooks/source'
import { findTeamrigCli, UI_LOOKUPS, type CliFiles, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'
import { TreeGoals } from '../hooks/tree-goals'
import type { TaskDetail, TaskRow } from '../types'
import { withActs } from './acts-front'
import type { Focus, Front } from './app'
import { readLastTyped, type LastTyped } from './last-typed'
import { NO_TEAM_FRONT } from './program'
import type { RunInit } from './processes'

/** The variables teamrig sets when it starts the UI (teamrig's src/ui/start.ts UI_ENV): its CLI's script, its Node.js. */
export const UI_ENV = { cli: 'TEAMRIG_CLI', node: 'TEAMRIG_NODE' } as const

/** The variable naming the session a teamrig CLI runs as. */
export const SESSION_ENV = 'TEAMRIG_SESSION'

/**
 * The conversation id the UI reads as: teamrig answers the sessions document's `self` by it, and no session runs in
 * the UI, so it names none and the area drawn is the one asked for.
 */
export const UI_CONVERSATION = 'teamrig-ui'

/** What the UI's command line names: the team to read and the session to draw, each null when not given. */
export type UiArgs = { readonly team: string | null; readonly session: string | null }

const FLAGS = { '--team': 'team', '--session': 'session' } as const

function isFlag(word: string): word is keyof typeof FLAGS {
  return Object.hasOwn(FLAGS, word)
}

/** The command line's team and session, or why it cannot be read: an unknown word, a flag without its value. */
export function uiArgs(words: readonly string[]): UiArgs | { readonly problem: string } {
  const named: { team: string | null; session: string | null } = { team: null, session: null }
  for (let at = 0; at < words.length; at += 2) {
    const flag = words[at] ?? ''
    if (!isFlag(flag)) return { problem: `unknown word ${JSON.stringify(flag)}: the UI takes --team <team> and --session <id>` }
    const value = words[at + 1]
    if (value === undefined || value.startsWith('--')) return { problem: `${flag} needs a value` }
    named[FLAGS[flag]] = value
  }
  if (named.session !== null && !SESSION_NAME.test(named.session)) return { problem: `--session ${JSON.stringify(named.session)} is not a session id` }
  return named
}

export type TeamFrontDeps = {
  readonly args: UiArgs
  /** The process's environment variable `name`, undefined when unset. */
  readonly env: (name: string) => string | undefined
  readonly files: Files
  /** What finding the teamrig CLI reads when teamrig did not name it. */
  readonly cliFiles: CliFiles
  /** Runs `argv`; rejects when it cannot start or outlasts its time (processes.ts). */
  readonly run: (argv: readonly string[], init: RunInit) => Promise<CliRun>
  readonly store: PaneStore
  /** The time now, epoch ms. */
  readonly now: () => number
  /** Calls `fn` every `ms` until cancelled. */
  readonly every: (ms: number, fn: () => void) => Timer
  /** The folder the UI was started in: where teamrig's pointer file is looked for, and where the CLI runs. */
  readonly cwd: string
  /** The person's home folder, null when the environment names none. */
  readonly home: string | null
  /** The machine's IANA zone (zone.ts machineZoneOf). */
  readonly machineZone: string
}

/**
 * The teamrig CLI the UI calls: the one that started it, else the teamrig command on the PATH, else Claude Code's plugin
 * list: the UI runs under any AI CLI, so the place every one shares comes first (T5046).
 */
export function uiCli(deps: Pick<TeamFrontDeps, 'env' | 'cliFiles' | 'home'>): Promise<TeamrigCli> {
  const named = deps.env(UI_ENV.cli)?.trim()
  if (named !== undefined && named !== '') return Promise.resolve({ kind: 'found', main: named })
  return findTeamrigCli(deps.cliFiles, {
    configDir: deps.env('CLAUDE_CONFIG_DIR'),
    home: deps.home ?? undefined,
    // Windows may name the PATH `Path`.
    path: deps.env('PATH') ?? deps.env('Path'),
  }, UI_LOOKUPS)
}

/** `argv` with the `node` the CLI's command line names (teamrig-cli.ts cliArgv) as `node`, the one teamrig ran. */
export function withNode(argv: readonly string[], node: string | undefined): readonly string[] {
  const [command, ...rest] = argv
  return command === 'node' && node !== undefined && node.trim() !== '' ? [node, ...rest] : argv
}

/**
 * `argv` with `--team <team>` after its words when it runs the CLI at `main`: the UI may run outside the team's
 * project, where teamrig would find no team, and teamrig takes `--team` on every command.
 */
export function withTeam(argv: readonly string[], main: string | null, team: string | null): readonly string[] {
  return team !== null && main !== null && argv[0] === 'node' && argv[1] === main ? [...argv, '--team', team] : argv
}

/** The places teamrig's variables name, `team` (the command line's, or the one followed to) over the environment's. */
function placesEnv(deps: Pick<TeamFrontDeps, 'env'>, team: string | null): PlacesEnv {
  return {
    TEAMRIG_PANE_GOALS_DOC: deps.env('TEAMRIG_PANE_GOALS_DOC'),
    TEAMRIG_PANE_SETTINGS: deps.env('TEAMRIG_PANE_SETTINGS'),
    [TEAMRIG_ENV.home]: deps.env(TEAMRIG_ENV.home),
    [TEAMRIG_ENV.team]: team ?? deps.env(TEAMRIG_ENV.team),
  }
}

/** What a project with no team draws: the UI has no setup view, so it says how to name one. */
export const NO_TEAM_PROBLEM = `no team here: run teamrig ui in a teamrig team's project, or with --team <team>`

/**
 * The team as the UI reads it: made at once, so the program draws while it starts, and serving the team's front from
 * the first read on. Its start never rejects: what it cannot find or read is the pane's problem line.
 *
 * Started with no session named (no `--session`, no TEAMRIG_SESSION), it follows the person (T5101): it draws the
 * session they last typed in, and on each POLL_MS reads the last-typed record again (one small file, last-typed.ts):
 * a new prompt in another session of its team moves the pin there. With no `--team`, the UI covers every team on the
 * host (T5256): it starts on the team of the record already there, else the one the environment or the
 * folder names, and a prompt in another team rebinds it to that team. A `--team` pins it to that team, and a record of
 * another team is passed over. A session named stays pinned and nothing is followed. Each run of the CLI runs as the
 * team it reads, in TEAMRIG_TEAM too: teamrig takes the caller's team from it, else the folder, and reads only that
 * team and the ones above it, so a team below the folder's would be refused.
 */
export class TeamFront {
  readonly #deps: TeamFrontDeps
  #live: LiveRegister | null = null
  #refresher: Refresher | null = null
  #front: ((focus: Focus) => Front) | null = null
  #isStopped = false
  /** The team bound, null when none is found; what a record is compared with. */
  #teamId: string | null = null
  /** The session drawn, null when teamrig finds it. */
  #pinned: string | null = null
  /** The `at` of the last record followed or seen at the start: an equal one is no new prompt. */
  #seenAt: string | null = null
  #followTimer: Timer | null = null
  #isFollowing = false

  constructor(deps: TeamFrontDeps) {
    this.#deps = deps
  }

  /** The front as it stands: the team's once it is read, before that one with nothing to read or act through. */
  front(focus: Focus): Front {
    return this.#front === null ? NO_TEAM_FRONT : this.#front(focus)
  }

  /** Finds the team, reads it once and keeps it read; a stop before it is done leaves no timer running. */
  async start(): Promise<void> {
    try {
      const deps = this.#deps
      const follows = deps.args.session === null && deps.env(SESSION_ENV) === undefined
      const record = follows ? await this.#lastTyped() : null
      this.#seenAt = record?.at ?? null
      await this.#bind(deps.args.team ?? record?.team ?? null, record)
      if (follows && !this.#isStopped) this.#followTimer = deps.every(POLL_MS, () => void this.#follow())
    } catch (error) {
      await this.#showProblem(messageOf(error)).catch(() => undefined)
    }
  }

  /** Stops the reads; the runs under way are the process port's to stop. */
  stop(): void {
    this.#isStopped = true
    this.#refresher?.stop()
    this.#live?.stop()
    this.#followTimer?.cancel()
    this.#followTimer = null
  }

  /** Reads the last-typed record and moves to a new one's session; never rejects, and never runs twice at once. */
  async #follow(): Promise<void> {
    if (this.#isFollowing || this.#isStopped) return
    this.#isFollowing = true
    try {
      const record = await this.#lastTyped()
      if (record === null || record.at === this.#seenAt || this.#isStopped) return
      this.#seenAt = record.at
      if (record.team !== this.#teamId) {
        // A team the command line named is pinned: a prompt in another team leaves the UI where it is.
        if (this.#deps.args.team !== null) return
        // The old team's refresher and register both stop, or its tick would go on reading the team left.
        this.#refresher?.stop()
        this.#live?.stop()
        await this.#bind(record.team, record)
      } else if (record.session !== this.#pinned) {
        this.#pinned = record.session
        await this.#live?.pin(record.session)
      }
    } catch (error) {
      await this.#showProblem(messageOf(error)).catch(() => undefined)
    } finally {
      this.#isFollowing = false
    }
  }

  #lastTyped(): Promise<LastTyped | null> {
    const deps = this.#deps
    return readLastTyped(deps.files, kitHomeOf(placesEnv(deps, null), deps.home))
  }

  /** Binds the UI to `team` (null: the one the environment or the folder names), drawing `record`'s session when it is that team's. */
  async #bind(team: string | null, record: LastTyped | null): Promise<void> {
    const deps = this.#deps
    const cli = await uiCli(deps)
    const places = await findPlaces({ env: placesEnv(deps, team), files: deps.files, home: deps.home, cwd: deps.cwd, machineZone: deps.machineZone })
    if (this.#isStopped) return
    const main = cli.kind === 'found' ? cli.main : null
    const teamId = places.kind === 'found' ? places.team.team : null
    const run = (argv: readonly string[], timeoutMs: number): Promise<CliRun> =>
      deps.run(withNode(withTeam(argv, main, teamId), deps.env(UI_ENV.node)), { cwd: deps.cwd, timeoutMs, ...(teamId === null ? {} : { env: { [TEAMRIG_ENV.team]: teamId } }) })
    const typed = record !== null && record.team === teamId ? record.session : null
    const session = deps.args.session ?? deps.env(SESSION_ENV) ?? typed
    this.#teamId = teamId
    this.#pinned = session
    // The pin is the session asked for or followed to, kept for this run alone: the UI has no `/teamrig-pane <area>`.
    let pinned: string | null = session
    const { source, held } = sourceOf(places, cli, run, deps)
    const live = new LiveRegister({
      source,
      sessionId: () => Promise.resolve(UI_CONVERSATION),
      now: () => Promise.resolve(deps.now()),
      publish: async change => {
        await deps.store.update('snapshot', change)
      },
      loadPin: () => Promise.resolve(pinned),
      savePin: (_conversation, area) => {
        pinned = area
        return Promise.resolve()
      },
    })
    this.#live = live
    const under = readersFront(places, deps)
    this.#front = places.kind === 'found' ? withActs(under, { cli, run, store: deps.store, now: deps.now }) : () => under
    await live.refresh()
    if (this.#isStopped) return
    // The first read is awaited, so the program draws the team at once; the refresher's own first read then finds
    // nothing moved. Its tick reads the register while no stream tells it when.
    const asker = new FollowedAsker(held)
    const refresher = new Refresher({ feed: NO_FEED, every: deps.every }, [registerSubject({ refresh: () => live.refresh(), documents: held, asker, refollow: () => refresher.refollow() })])
    this.#refresher = refresher
    live.startTick(deps.every)
    refresher.start()
  }

  async #showProblem(problem: string): Promise<void> {
    await this.#deps.store.update('snapshot', current => ({ ...current, problem }))
  }
}

/** Holds nothing: the source of a UI with no team to read. */
const NOTHING_HELD: HeldDocuments = { heldRevision: () => null, asker: null }

/**
 * What answers the snapshot for `places`: `teamrig read` over the register's files, or the problem in its place;
 * with what that reader holds, for the refresher to weigh.
 */
function sourceOf(
  places: Places,
  cli: TeamrigCli,
  run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>,
  deps: TeamFrontDeps,
): { readonly source: LivePorts['source']; readonly held: HeldDocuments } {
  if (places.kind === 'unset') return { source: { missing: NO_TEAM_PROBLEM }, held: NOTHING_HELD }
  if (places.kind === 'problem') return { source: { missing: places.problem }, held: NOTHING_HELD }
  const paths = registerPaths(places.dirs)
  const { team } = places
  const files = new TaskRegisterSource(deps.files, paths, places.settings, team, new TreeGoals(deps.files, paths.goals, team))
  const documents = new DocumentSource(files, cli, { run })
  return { source: documents, held: documents }
}

/** The front's readers of a card's refs and goals and of a reference file, over the team's folders. */
function readersFront(places: Places, deps: TeamFrontDeps): Front {
  if (places.kind === 'unset') return NO_TEAM_FRONT
  const found = places.kind === 'found' ? places : null
  const refPlaces: RefPlaces = {
    inboxDir: found === null ? null : registerPaths(found.dirs).inboxDir,
    home: deps.home,
    cwd: deps.cwd,
    teamDir: found === null ? null : found.team.dir,
    goalsDoc: places.goalsDoc,
  }
  const details = new TaskDetails(deps.files, refPlaces)
  const refFiles = new RefFileReader(deps.files, refPlaces)
  // A failed read still opens the card, its refs named unquoted and its goals by id, as the dock's does.
  const detailOf = (task: TaskRow): Promise<TaskDetail> => details.load(task).catch(() => ({ ref: task.ref, quotes: [], goals: [] }))
  const readFile: ReadsFile = file => refFiles.read(file)
  return { ports: { ...NO_TEAM_FRONT.ports, detailOf, readFile }, noting: null }
}
