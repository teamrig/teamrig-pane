// The dedicated UI's team (ui/team-front.ts): its command line, the CLI and Node.js it calls back, and what it draws
// and acts through, read from a team's files through the fake teamrig read (tests/fake-read.ts).
import { describe, expect, test } from 'claude-code/testing'
import { POLL_MS, TICK_MS, type Timer } from '../hooks/live'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import { registerPaths } from '../hooks/source'
import type { CliRun } from '../hooks/teamrig-cli'
import type { RunInit } from '../ui/processes'
import { NO_TEAM_FRONT } from '../ui/program'
import { NO_TEAM_PROBLEM, TeamFront, uiArgs, uiCli, UI_CONVERSATION, withNode, withTeam, type UiArgs } from '../ui/team-front'
import { fakeRead } from './fake-read'
import { HOUR, MemoryFiles, NOW, createLine, statusLine } from './fixtures'

const HOME = '/Homes/tester'
const TEAMS = `${HOME}/.teamrig/teams`
const STATE = `${TEAMS}/web/state`
const PATHS = registerPaths({ tasksDir: STATE, inboxDir: `${STATE}/inbox` })
const CLI_SCRIPT = '/kit/teamrig/dist/cli/main.js'
const NODE = '/opt/node/bin/node'

const CONFIG = { team: { id: 'web' }, sessions: ['lead', 'po', 'api'], roles: { lead: 'lead' } }

const EVENTS = [
  createLine('T1', { at: NOW - 5 * HOUR, by: 'lead', owner: 'po', title: 'Plan the page' }),
  statusLine('T1', 'po', NOW - 4 * HOUR, 'in-progress'),
  createLine('T2', { at: NOW - 3 * HOUR, by: 'po', owner: 'api', title: 'Add the route', source: 'po', ref: null }),
]

type Ran = { readonly argv: readonly string[]; readonly init: RunInit }

type Rig = {
  readonly team: TeamFront
  readonly store: MemoryStore
  readonly runs: Ran[]
  /** The timers started, by their period, and whether each was cancelled. */
  readonly timers: { readonly ms: number; isCancelled: boolean }[]
}

type RigOptions = {
  readonly args?: UiArgs
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  /** Thrown by every read of the environment, as a process that denies it would. */
  readonly envError?: Error
  readonly store?: MemoryStore
}

/** A store whose every write fails, as one past its quota would. */
class FailingStore extends MemoryStore {
  override update(): Promise<never> {
    return Promise.reject(new Error('store full'))
  }
}

/** Team web's files, its project at /work, read through the fake teamrig as the CLI teamrig named. */
function rig(options: RigOptions = {}): Rig {
  const files = new MemoryFiles()
  files.write('/work/.teamrig.json', JSON.stringify({ team: 'web' }))
  files.write(`${TEAMS}/web/config.json`, JSON.stringify(CONFIG))
  files.write(PATHS.events, EVENTS.join('\n'))
  const cwd = options.cwd ?? '/work'
  const folders = async (path: string): Promise<string[]> => (path === TEAMS ? ['web'] : [])
  const env: Readonly<Record<string, string>> = { TEAMRIG_CLI: CLI_SCRIPT, TEAMRIG_NODE: NODE, ...options.env }
  const read = fakeRead({ env: {}, files, folders, home: HOME, cwd, machineZone: 'UTC' }, () => NOW)
  const store = options.store ?? new MemoryStore(INITIAL_STATE)
  const { envError } = options
  const runs: Ran[] = []
  const timers: { ms: number; isCancelled: boolean }[] = []
  const team = new TeamFront({
    args: options.args ?? { team: null, session: null },
    env: name => {
      if (envError !== undefined) throw envError
      return env[name]
    },
    files,
    cliFiles: { exists: () => Promise.resolve(false), read: () => Promise.reject(new Error('no file')) },
    run: (argv, init): Promise<CliRun> => {
      runs.push({ argv, init })
      return read(argv)
    },
    store,
    now: () => NOW,
    every: (ms): Timer => {
      const timer = { ms, isCancelled: false }
      timers.push(timer)
      return {
        cancel: () => {
          timer.isCancelled = true
        },
      }
    },
    cwd,
    home: HOME,
    machineZone: 'UTC',
  })
  return { team, store, runs, timers }
}

const FOCUS = (): Promise<void> => Promise.resolve()

describe("the UI's command line", () => {
  test('takes the team and the session teamrig starts it with, each null when not named', () => {
    expect(uiArgs(['--team', 'web', '--session', 'api'])).toEqual({ team: 'web', session: 'api' })
    expect(uiArgs(['--team', 'web'])).toEqual({ team: 'web', session: null })
    expect(uiArgs([])).toEqual({ team: null, session: null })
  })

  test('refuses an unknown word, a flag with no value and a session id teamrig would refuse', () => {
    expect(uiArgs(['--teams', 'web'])).toEqual({ problem: 'unknown word "--teams": the UI takes --team <team> and --session <id>' })
    expect(uiArgs(['--team'])).toEqual({ problem: '--team needs a value' })
    expect(uiArgs(['--team', '--session', 'api'])).toEqual({ problem: '--team needs a value' })
    expect(uiArgs(['--session', 'Not A Session'])).toEqual({ problem: '--session "Not A Session" is not a session id' })
  })
})

describe('the teamrig the UI calls back', () => {
  test('is the CLI script teamrig named, else the one the dock finds, else why there is none', async () => {
    const cliFiles = { exists: () => Promise.resolve(false), read: () => Promise.reject(new Error('no file')) }
    expect(await uiCli({ env: name => (name === 'TEAMRIG_CLI' ? CLI_SCRIPT : undefined), cliFiles, home: HOME })).toEqual({ kind: 'found', main: CLI_SCRIPT })
    const missing = await uiCli({ env: () => undefined, cliFiles, home: HOME })
    expect(missing.kind).toBe('missing')
  })

  test("runs the CLI's command line on the Node.js teamrig ran, and any other program as named", () => {
    expect(withNode(['node', CLI_SCRIPT, 'read'], NODE)).toEqual([NODE, CLI_SCRIPT, 'read'])
    expect(withNode(['node', CLI_SCRIPT], undefined)).toEqual(['node', CLI_SCRIPT])
    expect(withNode(['git', 'status'], NODE)).toEqual(['git', 'status'])
  })

  test('names the team on every run of the CLI, and leaves another program and a run with no team as they are', () => {
    expect(withTeam(['node', CLI_SCRIPT, 'read', 'tasks', '--json'], CLI_SCRIPT, 'web')).toEqual(['node', CLI_SCRIPT, 'read', 'tasks', '--json', '--team', 'web'])
    expect(withTeam(['git', 'status'], CLI_SCRIPT, 'web')).toEqual(['git', 'status'])
    expect(withTeam(['node', '/other/script.js'], CLI_SCRIPT, 'web')).toEqual(['node', '/other/script.js'])
    expect(withTeam(['node', CLI_SCRIPT, 'read'], CLI_SCRIPT, null)).toEqual(['node', CLI_SCRIPT, 'read'])
    expect(withTeam(['node', CLI_SCRIPT, 'read'], null, 'web')).toEqual(['node', CLI_SCRIPT, 'read'])
  })
})

describe("the UI's team", () => {
  test("draws the team's tasks from teamrig read, for the session named, and keeps reading them", async () => {
    const { team, store, runs, timers } = rig({ args: { team: null, session: 'api' } })
    await team.start()
    const snapshot = await store.read('snapshot')
    expect(snapshot.problem).toBe(null)
    expect(snapshot.area).toBe('api')
    expect(snapshot.tasks.map(task => task.id)).toEqual(['T1', 'T2'])
    const [first] = runs
    expect(first?.argv.slice(0, 3)).toEqual([NODE, CLI_SCRIPT, 'read'])
    expect(first?.argv).toContain(UI_CONVERSATION)
    expect(first?.argv.slice(-2)).toEqual(['--team', 'web'])
    expect(first?.init.cwd).toBe('/work')
    expect(timers.map(timer => timer.ms)).toEqual([POLL_MS, TICK_MS])
  })

  test("draws the session the environment's TEAMRIG_SESSION names when the command line names none", async () => {
    const { team, store } = rig({ env: { TEAMRIG_SESSION: 'po' } })
    await team.start()
    expect((await store.read('snapshot')).area).toBe('po')
  })

  test("reads the team --team names, from a folder that is no team's project", async () => {
    const { team, store, runs } = rig({ args: { team: 'web', session: null }, cwd: '/elsewhere' })
    await team.start()
    expect((await store.read('snapshot')).tasks.map(task => task.id)).toEqual(['T1', 'T2'])
    expect(runs[0]?.argv.slice(-2)).toEqual(['--team', 'web'])
  })

  test("serves no front of its own before the team is read, and the team's acts after", async () => {
    const { team } = rig()
    expect(team.front(FOCUS)).toBe(NO_TEAM_FRONT)
    await team.start()
    const front = team.front(FOCUS)
    expect(front.ports.acting).not.toBe(null)
    expect(front.ports.pressing).not.toBe(null)
    expect(front.noting).not.toBe(null)
    expect(await front.ports.readFile('notes/missing.md')).toMatchObject({ kind: 'missing' })
  })

  test('with no team here or named, says how to name one and offers no acts', async () => {
    const { team, store, runs } = rig({ cwd: '/elsewhere' })
    await team.start()
    expect((await store.read('snapshot')).problem).toBe(NO_TEAM_PROBLEM)
    expect(team.front(FOCUS)).toBe(NO_TEAM_FRONT)
    expect(runs).toEqual([])
  })

  test('a start that fails draws why, and still resolves', async () => {
    const { team, store, runs } = rig({ envError: new Error('env denied') })
    await team.start()
    expect((await store.read('snapshot')).problem).toBe('env denied')
    expect(runs).toEqual([])
  })

  test('a start that fails with a store it cannot write still resolves', async () => {
    const { team, runs } = rig({ envError: new Error('env denied'), store: new FailingStore(INITIAL_STATE) })
    await team.start()
    expect(runs).toEqual([])
  })

  test('a stop before the first read is done starts no timer; a stop after cancels them', async () => {
    const early = rig()
    const started = early.team.start()
    early.team.stop()
    await started
    expect(early.timers).toEqual([])

    const late = rig()
    await late.team.start()
    late.team.stop()
    expect(late.timers.map(timer => timer.isCancelled)).toEqual([true, true])
  })
})
