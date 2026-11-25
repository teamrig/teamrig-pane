import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devRun, writeBuild } from './dev.ts';

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
