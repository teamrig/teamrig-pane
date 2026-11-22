import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DISK_CLI_FILES, DISK_FILES, isMissing } from '../../plugins/teamrig-pane/ui/disk.ts';

// The dedicated UI's disk port reads real files, so a plugin spec (which also runs under the engine's runner, with no
// `node:` module) cannot hold it: these read a temporary folder.
let dir = '';
let file = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ui-disk-'));
  file = join(dir, 'events.jsonl');
  await writeFile(file, 'line\n');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A path no file system takes: its NUL fails the call before the disk is asked, with a code that is no missing path's. */
const REFUSED_PATH = 'bad\0path';

describe("the UI's disk", () => {
  it('stamps a file with its size, and a folder or a missing path with null', async () => {
    const stamp = await DISK_FILES.stamp(file);
    assert.equal(stamp?.size, 5);
    assert.equal(await DISK_FILES.stamp(dir), null);
    assert.equal(await DISK_FILES.stamp(join(dir, 'missing.jsonl')), null);
    assert.equal(await DISK_FILES.stamp(join(file, 'below-a-file')), null);
  });

  it('throws on a path it cannot stamp for any reason but its absence', async () => {
    await assert.rejects(DISK_FILES.stamp(REFUSED_PATH));
  });

  it("reads a file's text", async () => {
    assert.equal(await DISK_FILES.read(file), 'line\n');
  });


  it("finds the CLI's files: whether one is there, and its text", async () => {
    assert.equal(await DISK_CLI_FILES.exists(file), true);
    assert.equal(await DISK_CLI_FILES.exists(join(dir, 'missing.js')), false);
    assert.equal(await DISK_CLI_FILES.read(file), 'line\n');
  });
});

describe('a missing path', () => {
  it('is an error with a missing code, and no other error or value', () => {
    const coded = (code: unknown): Error => Object.assign(new Error('failed'), { code });
    assert.equal(isMissing(coded('ENOENT')), true);
    assert.equal(isMissing(coded('ENOTDIR')), true);
    assert.equal(isMissing(coded('EACCES')), false);
    assert.equal(isMissing(coded(2)), false);
    assert.equal(isMissing(new Error('no code')), false);
    assert.equal(isMissing({ code: 'ENOENT' }), false);
  });
});
