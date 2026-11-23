import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('cron-probe.yml', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/cron-probe.yml', import.meta.url), 'utf8');

  it('runs hourly on a schedule and by hand, on no other event', () => {
    assert.match(workflow, /^on:\n {2}schedule:\n {4}- cron: '17 \* \* \* \*'\n {2}workflow_dispatch:\n\n/m);
  });

  it('holds no token permission and no job widens it', () => {
    assert.match(workflow, /^permissions: \{\}$/m);
    assert.doesNotMatch(workflow, /^ +permissions:/m);
  });

  it('runs one echo step, with no action, checkout or secret', () => {
    assert.deepEqual(workflow.match(/^\s*- (?:run|uses): .+$/gm)?.map((line) => line.trim()), ['- run: echo "cron probe fired"']);
    assert.doesNotMatch(workflow, /secrets\.|github\.token/);
  });
});
