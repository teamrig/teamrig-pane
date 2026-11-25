import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRY } from './build.ts';
import { emitUi } from './emit.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('emitUi', () => {
  const elsewhere = mkdtempSync(join(tmpdir(), 'teamrig-ui-emit-test-'));

  after(() => {
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('emits the UI of this checkout, its entry among the files, by /-separated paths', () => {
    const emitted = emitUi(ROOT);
    assert.ok(emitted.ok, emitted.ok ? '' : emitted.output);
    assert.ok(emitted.files.has(ENTRY));
    assert.ok([...emitted.files.keys()].every((path) => !path.includes('\\')));
  });

  it('says tsc failed, with its exit and output, in a folder that is no checkout', () => {
    const emitted = emitUi(elsewhere);
    assert.equal(emitted.ok, false);
    assert.ok(!emitted.ok && emitted.status === 1 && emitted.output.length > 0);
  });
});
