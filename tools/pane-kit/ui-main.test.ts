import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The dedicated UI's entry takes the terminal as it loads, so no test can import it: this one runs it as the
// program it is, a `node` process on piped streams, under the kit that resolves the plugin's imports.
const MAIN = fileURLToPath(new URL('../../plugins/teamrig-pane/ui/main.ts', import.meta.url));
const KIT = new URL('./register.ts', import.meta.url).href;

const ESC = '\u001b';
/** The alternate screen taken and given back (ui/terminal.ts ENTER, LEAVE). */
const TAKEN = `${ESC}[?1049h`;
const GIVEN_BACK = `${ESC}[?1049l`;
/** How a frame starts: the cursor sent to the first cell. */
const FRAME = `${ESC}[H`;
/** Long past a cold start on a loaded host; a run that reaches it is killed and fails on its exit code. */
const LIMIT_MS = 60_000;

interface Ended {
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

interface RunOptions {
  /** The words after the entry. */
  readonly args?: readonly string[];
  /** Variables set over the test's own; an undefined one is unset. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  /** Text a frame must show before the keys are sent; any frame will do when none. */
  readonly until?: string;
}

/** The test's environment with `over` laid on it, less NODE_TEST_CONTEXT, which is for the runner's own children. */
function envOf(over: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...over })) {
    if (key !== 'NODE_TEST_CONTEXT' && value !== undefined) env[key] = value;
  }
  return env;
}

/** Runs the entry, sends `keys` once it drew a frame showing `until`, and resolves how it ended. */
function ranWith(keys: string, options: RunOptions = {}): Promise<Ended> {
  return new Promise<Ended>((resolve, reject) => {
    const child = spawn(process.execPath, [`--import=${KIT}`, MAIN, ...(options.args ?? [])], {
      env: envOf(options.env ?? {}),
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let isSent = false;
    const limit = setTimeout(() => child.kill(), LIMIT_MS);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      out += chunk;
      if (!isSent && out.includes(FRAME) && (options.until === undefined || out.includes(options.until))) {
        isSent = true;
        child.stdin.write(keys);
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      err += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(limit);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(limit);
      resolve({ code, out, err });
    });
  });
}

describe('the dedicated UI entry under node', () => {
  it('takes the screen, draws, and on q gives it back and exits 0', async () => {
    const ended = await ranWith('q');
    assert.equal(ended.err, '');
    assert.equal(ended.code, 0);
    assert.ok(ended.out.startsWith(TAKEN), 'the alternate screen is taken first');
    assert.ok(ended.out.includes(FRAME), 'a frame is drawn');
    assert.ok(ended.out.endsWith(GIVEN_BACK), 'the alternate screen is given back last');
  });

  it('ends on Ctrl+C read as a key, the terminal given back', async () => {
    const ended = await ranWith('\u0003');
    assert.equal(ended.err, '');
    assert.equal(ended.code, 0);
    assert.ok(ended.out.endsWith(GIVEN_BACK), 'the alternate screen is given back last');
  });

  it('refuses a command line it cannot read with a usage exit, the screen never taken', async () => {
    const ended = await ranWith('q', { args: ['--bogus'] });
    assert.equal(ended.code, 2);
    assert.ok(ended.err.startsWith('teamrig ui: unknown word "--bogus"'), ended.err);
    assert.equal(ended.out, '');
  });
});

describe('the dedicated UI entry reading a team', () => {
  let home = '';
  let cli = '';

  before(async () => {
    home = await mkdtemp(join(tmpdir(), 'ui-main-'));
    const team = join(home, 'teams', 'web');
    await mkdir(team, { recursive: true });
    await writeFile(join(team, 'config.json'), JSON.stringify({ team: { id: 'web' }, sessions: ['lead'], roles: { lead: 'lead' } }));
    cli = join(home, 'cli.js');
    await writeFile(cli, "process.stderr.write('REFUSED fake teamrig'); process.exitCode = 2;\n");
  });

  after(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('runs the teamrig that started it on the Node.js it names, draws what it answers, and on q exits 0', async () => {
    const ended = await ranWith('q', {
      args: ['--team', 'web'],
      cwd: home,
      env: { TEAMRIG_HOME: home, TEAMRIG_CLI: cli, TEAMRIG_NODE: process.execPath, USERPROFILE: undefined, HOME: home },
      until: 'fake teamrig',
    });
    assert.equal(ended.err, '');
    assert.equal(ended.code, 0);
    assert.ok(ended.out.endsWith(GIVEN_BACK), 'the alternate screen is given back last');
  });
});
