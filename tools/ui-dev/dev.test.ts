import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_FINDINGS } from '../lib/exit.ts';
import { ENTRY } from '../ui-archive/build.ts';
import type { Emitted } from '../ui-archive/emit.ts';
import { DEV_OUT, devRun, uiDev, writeBuild, type DevPorts, type DevRun, type Ended } from './dev.ts';

/** Ports that record what the run asked of them; `emitted` and `ended` are what tsc and the child answer. */
function fakePorts(emitted: Emitted, ended: Ended): DevPorts & { readonly started: DevRun[]; readonly logged: string[]; readonly warned: string[] } {
  const started: DevRun[] = [];
  const logged: string[] = [];
  const warned: string[] = [];
  return {
    started,
    logged,
    warned,
    emit: () => emitted,
    manifest: () => '{"version":"9.9.9"}',
    start: (run) => {
      started.push(run);
      return ended;
    },
    log: (line) => logged.push(line),
    warn: (line) => warned.push(line),
  };
}

const EMITTED: Emitted = { ok: true, files: new Map([[ENTRY, 'main']]) };

describe('uiDev', () => {
  const root = mkdtempSync(join(tmpdir(), 'teamrig-ui-dev-run-'));
  const call = { root, node: 'node', words: ['--team', 'acme'], env: { INIT_CWD: 'D:/work/acme' }, cwd: 'D:/pane' };

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the build under the checkout and runs its entry with the words, ending with its exit code', () => {
    const ports = fakePorts(EMITTED, { status: 3 });
    assert.equal(uiDev(call, ports), 3);
    const entry = join(root, ...DEV_OUT.split('/'), ...ENTRY.split('/'));
    assert.deepEqual(ports.started, [{ command: 'node', args: [entry, '--team', 'acme'], cwd: 'D:/work/acme' }]);
    assert.equal(readFileSync(entry, 'utf8'), 'main');
    assert.deepEqual([...ports.logged, ...ports.warned], []);
  });

  it('says the emit failed with what tsc printed, and starts nothing', () => {
    const ports = fakePorts({ ok: false, status: 2, output: 'error TS1005' }, { status: 0 });
    assert.equal(uiDev(call, ports), EXIT_FINDINGS);
    assert.deepEqual(ports.logged, ['ui dev: the emit failed (tsc exit 2):', 'error TS1005']);
    assert.deepEqual(ports.started, []);
  });

  it('says the build did not start, and why', () => {
    const ports = fakePorts(EMITTED, { error: new Error('spawn node ENOENT'), status: null });
    assert.equal(uiDev(call, ports), EXIT_FINDINGS);
    assert.deepEqual(ports.warned, ['ui dev: node did not start: spawn node ENOENT']);
  });

  it('a build a signal ended, with no exit code, is a finding', () => {
    assert.equal(uiDev(call, fakePorts(EMITTED, { status: null })), EXIT_FINDINGS);
  });
});

describe('writeBuild', () => {
  const folder = mkdtempSync(join(tmpdir(), 'teamrig-ui-dev-'));

  after(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('writes every file at its path, drops what an older build left, and returns the entry', () => {
    const out = join(folder, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'stale.js'), 'old', 'utf8');
    const entry = writeBuild(out, {
      entry: 'ui/main.js',
      files: [
        { path: 'package.json', text: '{"type":"module"}\n' },
        { path: 'ui/main.js', text: 'main' },
        { path: 'hooks/core/read/index.js', text: 'read' },
      ],
    });
    assert.equal(entry, join(out, 'ui', 'main.js'));
    assert.equal(readFileSync(entry, 'utf8'), 'main');
    assert.equal(readFileSync(join(out, 'hooks', 'core', 'read', 'index.js'), 'utf8'), 'read');
    assert.equal(existsSync(join(out, 'stale.js')), false);
  });
});

describe('devRun', () => {
  it('runs node on the entry with the words given, in the folder npm was run from', () => {
    assert.deepEqual(devRun('node', 'e.js', ['--team', 'acme'], { INIT_CWD: 'D:/work/acme' }, 'D:/pane'), {
      command: 'node',
      args: ['e.js', '--team', 'acme'],
      cwd: 'D:/work/acme',
    });
  });

  it('runs in its own folder when npm named none, or an empty one', () => {
    assert.equal(devRun('node', 'e.js', [], {}, 'D:/pane').cwd, 'D:/pane');
    assert.equal(devRun('node', 'e.js', [], { INIT_CWD: '' }, 'D:/pane').cwd, 'D:/pane');
  });
});
