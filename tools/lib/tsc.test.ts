import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TSC } from './tsc.ts';

describe('TSC', () => {
  it("is the compiler Node finds from the tools, so a worktree without node_modules finds its main checkout's", () => {
    assert.ok(resolve(TSC).endsWith(join('node_modules', 'typescript', 'bin', 'tsc')), TSC);
    assert.ok(readFileSync(TSC, 'utf8').length > 0);
  });
});
