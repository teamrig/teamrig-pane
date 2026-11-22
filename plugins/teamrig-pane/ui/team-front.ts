// The dedicated UI's team: the register the dock binds at a session's start (hooks/register.tsx `bind`), on ports a
// process gives instead of the engine's `$`. It finds the team as the dock does (places.ts), reads the tasks, inbox,
// sessions and settings through `teamrig read` (document-source.ts) every POLL_MS (live.ts), and writes each snapshot
// to the store, which draws it. teamrig starts the UI as `node <entry> --team <team> [--session <id>]` with its CLI's
// script and its Node.js in the environment (teamrig's src/ui/start.ts), so the UI calls back the teamrig that
// started it. It is not a Claude Code conversation: the area it draws is the `--session` named, else the
// environment's TEAMRIG_SESSION, else the one teamrig finds for the asker. Runs the CLI and reads files only.
import { SESSION_NAME } from '../hooks/core/read/index'
import { TaskDetails, type RefPlaces } from '../hooks/details'
import { DocumentSource } from '../hooks/document-source'
import { messageOf } from '../hooks/errors'
import { LiveRegister, type LivePorts, type Timer } from '../hooks/live'
import type { PaneStore } from '../hooks/pane-store'
import { findPlaces, TEAMRIG_ENV, type Places, type PlacesEnv } from '../hooks/places'
import type { ReadsFile } from '../hooks/presses'
import { RefFileReader } from '../hooks/ref-file'
import { registerPaths, TaskRegisterSource, type Files } from '../hooks/source'
import { findTeamrigCli, type CliFiles, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'
import { TreeGoals } from '../hooks/tree-goals'
import type { TaskDetail, TaskRow } from '../types'
import { withActs } from './acts-front'
import type { Focus, Front } from './app'
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

/** The teamrig CLI the UI calls: the one that started it, else the one the dock would find. */
export function uiCli(deps: Pick<TeamFrontDeps, 'env' | 'cliFiles' | 'home'>): Promise<TeamrigCli> {
  const named = deps.env(UI_ENV.cli)?.trim()
  if (named !== undefined && named !== '') return Promise.resolve({ kind: 'found', main: named })
  return findTeamrigCli(deps.cliFiles, {
    configDir: deps.env('CLAUDE_CONFIG_DIR'),
    home: deps.home ?? undefined,
    // Windows may name the PATH `Path`.
    path: deps.env('PATH') ?? deps.env('Path'),
  })
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

/** The places teamrig's variables name, the command line's team over the environment's. */
function placesEnv(deps: Pick<TeamFrontDeps, 'args' | 'env'>): PlacesEnv {
  return {
    TEAMRIG_PANE_GOALS_DOC: deps.env('TEAMRIG_PANE_GOALS_DOC'),
    TEAMRIG_PANE_SETTINGS: deps.env('TEAMRIG_PANE_SETTINGS'),
    [TEAMRIG_ENV.home]: deps.env(TEAMRIG_ENV.home),
    [TEAMRIG_ENV.team]: deps.args.team ?? deps.env(TEAMRIG_ENV.team),
  }
}

/** What a project with no team draws: the UI has no setup view, so it says how to name one. */
export const NO_TEAM_PROBLEM = `no team here: run teamrig ui in a teamrig team's project, or with --team <team>`

/**
 * The team as the UI reads it: made at once, so the program draws while it starts, and serving the team's front from
 * the first read on. Its start never rejects: what it cannot find or read is the pane's problem line.
 */
export class TeamFront {
  readonly #deps: TeamFrontDeps
  #live: LiveRegister | null = null
  #front: ((focus: Focus) => Front) | null = null
  #isStopped = false

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
      await this.#bind()
    } catch (error) {
      await this.#showProblem(messageOf(error)).catch(() => undefined)
    }
  }

  /** Stops the reads; the runs under way are the process port's to stop. */
  stop(): void {
    this.#isStopped = true
    this.#live?.stop()
  }

  async #bind(): Promise<void> {
    const deps = this.#deps
    const cli = await uiCli(deps)
    const places = await findPlaces({ env: placesEnv(deps), files: deps.files, home: deps.home, cwd: deps.cwd, machineZone: deps.machineZone })
    if (this.#isStopped) return
    const main = cli.kind === 'found' ? cli.main : null
    const teamId = places.kind === 'found' ? places.team.team : null
    const run = (argv: readonly string[], timeoutMs: number): Promise<CliRun> =>
      deps.run(withNode(withTeam(argv, main, teamId), deps.env(UI_ENV.node)), { cwd: deps.cwd, timeoutMs })
    const session = deps.args.session ?? deps.env(SESSION_ENV) ?? null
    // The pin is the session asked for, kept for this run alone: the UI has no `/teamrig-pane <area>` to change it.
    let pinned: string | null = session
    const live = new LiveRegister({
      source: sourceOf(places, cli, run, deps),
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
    if (!this.#isStopped) live.startTimers(deps.every)
  }

  async #showProblem(problem: string): Promise<void> {
    await this.#deps.store.update('snapshot', current => ({ ...current, problem }))
  }
}

/** What answers the snapshot for `places`: `teamrig read` over the register's files, or the problem in its place. */
function sourceOf(places: Places, cli: TeamrigCli, run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>, deps: TeamFrontDeps): LivePorts['source'] {
  if (places.kind === 'unset') return { missing: NO_TEAM_PROBLEM }
  if (places.kind === 'problem') return { missing: places.problem }
  const paths = registerPaths(places.dirs)
  const { team } = places
  const files = new TaskRegisterSource(deps.files, paths, places.settings, team, new TreeGoals(deps.files, paths.goals, team))
  return new DocumentSource(files, cli, { run })
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
