import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRY } from '../ui-archive/build.ts';
import { DEV_OUT } from './dev.ts';

// The tool is proven as a UI developer runs it: from a folder of no team, on piped streams, the UI quit with q.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

const ESC = '\u001b';
/** The alternate screen taken and given back, and how a frame starts (ui/terminal.ts). */
const TAKEN = `${ESC}[?1049h`;
const GIVEN_BACK = `${ESC}[?1049l`;
const FRAME = `${ESC}[H`;
/**
 * How long the UI may run once it wrote its first byte: long past a cold start on a loaded host; a run that reaches it
 * is killed and fails on its exit code. It starts only at that byte, as the tsc emit before it took 113 s on a loaded
 * host (T5129's first check), and a kill inside the emit says nothing about the UI.
 */
const LIMIT_MS = 60_000;
/** The whole spec, emit included: the emit alone has taken over 2 minutes beside a full check. */
const SPEC_TIMEOUT_MS = 600_000;

interface Ended {
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

/** Runs the tool in `cwd` as npm would (`INIT_CWD`), sends q once the UI drew its first frame, and resolves its end. */
function ranIn(cwd: string): Promise<Ended> {
  // A child of a test inherits NODE_TEST_CONTEXT, which is for the runner's own children.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
  return new Promise<Ended>((done, reject) => {
    const child = spawn(process.execPath, [CLI], { cwd: ROOT, env: { ...env, INIT_CWD: cwd }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let isSent = false;
    let limit: NodeJS.Timeout | undefined;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      limit ??= setTimeout(() => child.kill(), LIMIT_MS);
      out += chunk;
      if (!isSent && out.includes(FRAME)) {
        isSent = true;
        child.stdin.write('q');
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
      done({ code, out, err });
    });
  });
}

describe('the ui dev tool', () => {
  const folder = mkdtempSync(join(tmpdir(), 'teamrig-ui-dev-cli-'));

  after(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('builds this checkout’s UI into .tmp/ui-dev and runs it here: it takes the screen, draws, and on q exits 0', { timeout: SPEC_TIMEOUT_MS }, async () => {
    const ended = await ranIn(folder);
    assert.equal(ended.err, '');
    assert.equal(ended.code, 0);
    assert.ok(ended.out.startsWith(TAKEN), 'the alternate screen is taken first');
    assert.ok(ended.out.includes(FRAME), 'a frame is drawn');
    assert.ok(ended.out.endsWith(GIVEN_BACK), 'the alternate screen is given back last');
    assert.ok(existsSync(join(ROOT, ...DEV_OUT.split('/'), ...ENTRY.split('/'))));
  });
});
