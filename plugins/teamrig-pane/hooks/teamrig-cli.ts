// The teamrig CLI the pane runs (T1359): the installed teamrig plugin's `dist/cli/main.js`, found as teamrig's own
// status line finds it. Claude Code lists its installed plugins in `plugins/installed_plugins.json` under its config
// folder (CLAUDE_CONFIG_DIR, else ~/.claude): `{ plugins: { "teamrig@<marketplace>": [{ installPath, ... }] } }`. The
// first `teamrig@*` install whose main.js is there is the one run, with `node`, and a run's answer read as lines.
// With no such install (a plugin folder loaded with --plugin-dir, or a list in another config folder: issue #119), the
// `teamrig` command on the PATH is the fallback: the plugin's `bin/teamrig` (and `bin/teamrig.cmd`) run
// `<bin>/../dist/cli/main.js`, so that file beside the first PATH folder holding the command is run the same way. The
// hooks API cannot follow a link, so a linked or npm-made shim with no dist beside it is passed over. That order is the
// dock's (DOCK_LOOKUPS); the dedicated UI runs under any AI CLI, so it looks on the PATH first (UI_LOOKUPS, T5046).
// Reads files only; runs nothing.
import { messageOf } from './errors'
import { slashed } from './source'

/** The plugin list's path under Claude Code's config folder, from that folder's root. */
const PLUGIN_LIST = 'plugins/installed_plugins.json'
/** The CLI's entry under a teamrig install. */
const CLI_MAIN = 'dist/cli/main.js'
const TEAMRIG_KEY = 'teamrig@'

/** The CLI found, or why there is none, as one line the pane shows. */
export type TeamrigCli = { readonly kind: 'found'; readonly main: string } | { readonly kind: 'missing'; readonly problem: string }

export type CliFiles = {
  exists: (path: string) => Promise<boolean>
  /** Rejects when the file cannot be read. */
  read: (path: string) => Promise<string>
}

/** The teamrig command's names in its plugin's `bin` folder: the sh script, and the one Windows runs. */
const COMMAND_NAMES = ['teamrig', 'teamrig.cmd'] as const

/**
 * Where to look: Claude Code's config folder variable, the user's home and the PATH, as the session's environment holds
 * them.
 */
export type CliEnv = { readonly configDir: string | undefined; readonly home: string | undefined; readonly path: string | undefined }

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Claude Code's plugin list: under CLAUDE_CONFIG_DIR when it is set, else under the home's `.claude`; null with neither. */
export function pluginListPath(env: CliEnv): string | null {
  const configDir = env.configDir?.trim()
  if (configDir !== undefined && configDir !== '') return `${slashed(configDir)}/${PLUGIN_LIST}`
  const home = env.home?.trim()
  return home === undefined || home === '' ? null : `${slashed(home)}/.claude/${PLUGIN_LIST}`
}

/** Each teamrig install's folder the plugin list names, in its order, slashes made forward; none in a list it cannot read. */
export function teamrigInstalls(text: string): string[] {
  let list: unknown
  try {
    list = JSON.parse(text)
  } catch {
    return []
  }
  const plugins = isRecord(list) ? list['plugins'] : undefined
  if (!isRecord(plugins)) return []
  const found: string[] = []
  for (const [key, installs] of Object.entries(plugins)) {
    if (!key.startsWith(TEAMRIG_KEY) || !Array.isArray(installs)) continue
    for (const install of installs) {
      const path = isRecord(install) ? install['installPath'] : undefined
      if (typeof path === 'string' && path.trim() !== '') found.push(slashed(path.trim()))
    }
  }
  return found
}

/**
 * The PATH's folders in order, slashes made forward, blanks and quotes dropped. Windows splits it on `;`, others on `:`;
 * a value holding a `;` or starting with a drive letter is a Windows one, as a drive's `C:` would break a `:` split.
 */
export function pathFolders(path: string | undefined): string[] {
  if (path === undefined) return []
  const separator = path.includes(';') || /^\s*"?[A-Za-z]:[\\/]/.test(path) ? ';' : ':'
  return path
    .split(separator)
    .map(folder => folder.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter(folder => folder !== '')
    .map(slashed)
}

/** The folder above `folder`, or null when it has none to name. */
function parentOf(folder: string): string | null {
  const cut = folder.lastIndexOf('/')
  return cut <= 0 ? null : folder.slice(0, cut)
}

async function hasCommand(files: CliFiles, folder: string): Promise<boolean> {
  for (const name of COMMAND_NAMES) if (await files.exists(`${folder}/${name}`)) return true
  return false
}

/** The CLI beside the first PATH folder whose teamrig command has it; else why none, as a phrase the caller ends. */
async function cliOnPath(files: CliFiles, path: string | undefined): Promise<TeamrigCli> {
  const folders = pathFolders(path)
  if (folders.length === 0) return { kind: 'missing', problem: 'no PATH to find the teamrig command on' }
  // A folder that cannot be checked (denied, locked) is passed over: a later one may still hold the command.
  let failure: string | null = null
  for (const folder of folders) {
    const parent = parentOf(folder)
    if (parent === null) continue
    try {
      if (!(await hasCommand(files, folder))) continue
      const main = `${parent}/${CLI_MAIN}`
      if (await files.exists(main)) return { kind: 'found', main }
    } catch (error) {
      failure ??= messageOf(error)
    }
  }
  return {
    kind: 'missing',
    problem: failure === null ? `no teamrig command on the PATH with its ${CLI_MAIN} beside it` : `cannot look on the PATH: ${failure}`,
  }
}

/** The first teamrig install in Claude Code's plugin list whose CLI is there; else why none, as a phrase the caller ends. */
async function cliInPluginList(files: CliFiles, env: CliEnv): Promise<TeamrigCli> {
  const listPath = pluginListPath(env)
  if (listPath === null) return { kind: 'missing', problem: 'no CLAUDE_CONFIG_DIR or home folder to find the teamrig plugin under' }
  try {
    if (!(await files.exists(listPath))) return { kind: 'missing', problem: `no plugin list at ${listPath}` }
    for (const install of teamrigInstalls(await files.read(listPath))) {
      const main = `${install}/${CLI_MAIN}`
      if (await files.exists(main)) return { kind: 'found', main }
    }
    return { kind: 'missing', problem: `no teamrig plugin with its CLI in ${listPath}` }
  } catch (error) {
    return { kind: 'missing', problem: `cannot find the teamrig plugin: ${messageOf(error)}` }
  }
}

/** One place the CLI is looked for: found, or why not, as a phrase the caller ends. Never rejects. */
export type CliLookup = (files: CliFiles, env: CliEnv) => Promise<TeamrigCli>

/** The teamrig command on the PATH: the same under every AI CLI. */
export const ON_PATH: CliLookup = (files, env) => cliOnPath(files, env.path)
/** Claude Code's own list of installed plugins: a place only under Claude Code. */
export const CLAUDE_CODE_PLUGINS: CliLookup = cliInPluginList

/** The dock runs inside Claude Code, so the install Claude Code loaded it beside comes first. */
export const DOCK_LOOKUPS: readonly CliLookup[] = [CLAUDE_CODE_PLUGINS, ON_PATH]
/** The dedicated UI runs under any AI CLI or none (T5046), so the host-neutral PATH comes first. */
export const UI_LOOKUPS: readonly CliLookup[] = [ON_PATH, CLAUDE_CODE_PLUGINS]

/**
 * The teamrig CLI: the first of `lookups` that finds it, in their order; else why none did, every place named. A failed
 * read or check is a problem too, never a throw.
 */
export async function findTeamrigCli(files: CliFiles, env: CliEnv, lookups: readonly CliLookup[] = DOCK_LOOKUPS): Promise<TeamrigCli> {
  const problems: string[] = []
  for (const lookup of lookups) {
    const found = await lookup(files, env)
    if (found.kind === 'found') return found
    problems.push(found.problem)
  }
  return { kind: 'missing', problem: `${problems.join(', and ')}: install the teamrig plugin` }
}

/** Where the CLI is now: what a run reads each time it starts, so a CLI found again is the one the next run uses. */
export type CliSource = { readonly current: () => TeamrigCli }

/** A CLI that never moves: a found one or why none is, for a caller that finds it once. */
export function fixedCli(cli: TeamrigCli): CliSource {
  return { current: () => cli }
}

/**
 * The CLI a tab runs, found again on `refind` (T5859). An update installs teamrig in a new folder and Claude Code's
 * plugin list names it, but a tab keeps its loaded pane: found once, every read and follower would run the old CLI until
 * the tab restarts, and the newer one ends that follower (ENDED) only for the pane to start it again from the same old
 * path. The events follower asks `refind` at each follow, so the follow after that end, and every read after it, run the
 * CLI installed now. A find that rejects keeps the CLI it had.
 */
export class CliHolder implements CliSource {
  private found: TeamrigCli
  private readonly find: () => Promise<TeamrigCli>

  private constructor(find: () => Promise<TeamrigCli>, first: TeamrigCli) {
    this.find = find
    this.found = first
  }

  /** A holder over `find`, with its first find awaited. */
  static async start(find: () => Promise<TeamrigCli>): Promise<CliHolder> {
    return new CliHolder(find, await find())
  }

  readonly current = (): TeamrigCli => this.found

  /** Finds the CLI again and holds what it finds; the one it held when the find rejects. */
  readonly refind = async (): Promise<TeamrigCli> => {
    try {
      this.found = await this.find()
    } catch {
      // findTeamrigCli never rejects; a port that does leaves the last CLI found in use rather than none.
    }
    return this.found
  }
}

/** The command line that runs the CLI with `args`. */
export function cliArgv(main: string, args: readonly string[]): string[] {
  return ['node', main, ...args]
}

/** What a CLI run answers: `$.process.run`'s result, the fields the pane reads. */
export type CliRun = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }

/** A run's non-empty lines of `text`, trimmed. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
}

/** Why a run of `teamrig <command>` failed: what it wrote to stderr, else its exit code. */
export function failureLines(run: CliRun, command: string): string[] {
  const said = linesOf(run.stderr)
  return said.length > 0 ? said : [`teamrig ${command} exited ${run.exitCode}`]
}
