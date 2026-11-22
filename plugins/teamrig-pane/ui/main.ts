// The dedicated UI's entry, the file `node` runs: it hands the process's own streams, signals, environment and disk
// to the program (program.ts) and the team it reads (team-front.ts), and sets the exit code it answers. Nothing is
// exported and nothing else lives here, since loading this file takes the terminal.
import process from 'node:process'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import { machineZoneOf } from '../hooks/zone'
import { DISK_CLI_FILES, DISK_FILES } from './disk'
import { Processes } from './processes'
import { ownLook, runProgram } from './program'
import { TeamFront, uiArgs } from './team-front'
import { WatchedStore } from './watched-store'

/** The exit code of a command line the UI cannot read, as a shell's own usage errors answer. */
const USAGE_CODE = 2

const args = uiArgs(process.argv.slice(2))
if ('problem' in args) {
  process.stderr.write(`teamrig ui: ${args.problem}\n`)
  process.exitCode = USAGE_CODE
} else {
  const env = (name: string): string | undefined => process.env[name]
  // One store for the team and the program, so the team's reads ask for drawings as a press does.
  const store = new WatchedStore(new MemoryStore(INITIAL_STATE))
  const processes = new Processes()
  const team = new TeamFront({
    args,
    env,
    files: DISK_FILES,
    cliFiles: DISK_CLI_FILES,
    run: (argv, init) => processes.run(argv, init),
    store,
    now: () => Date.now(),
    every: (ms, fn) => {
      const timer = setInterval(fn, ms)
      return { cancel: () => clearInterval(timer) }
    },
    cwd: process.cwd(),
    home: env('USERPROFILE') ?? env('HOME') ?? null,
    machineZone: machineZoneOf(env('TZ'), Intl.DateTimeFormat().resolvedOptions().timeZone),
  })
  // The program draws at once; the team's tasks come in with its first read.
  void team.start()
  process.exitCode = await runProgram({
    input: process.stdin,
    output: process.stdout,
    signals: process,
    store,
    front: focus => team.front(focus),
    look: ownLook(),
    errors: process.stderr,
    ending: () => {
      team.stop()
      processes.stopAll()
    },
  })
}
