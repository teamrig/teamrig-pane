import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TempRepo } from '../lib/temp-repo.ts';
import { PLUGIN_JSON } from './publish.ts';

const CLI = fileURLToPath(new URL('./publish-cli.ts', import.meta.url));

describe('release publish CLI', () => {
  let repo: TempRepo;
  let origin: string;

  /** Commits a plugin.json naming `version` and returns the commit's sha. */
  const release = (version: string): string => {
    repo.write(PLUGIN_JSON, JSON.stringify({ name: 'teamrig-pane', version }));
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', `chore(main): release teamrig-pane ${version}`);
    return repo.git('rev-parse', 'HEAD').trim();
  };
  const remote = (ref: string): string => repo.git('ls-remote', origin, ref).split('\t')[0] ?? '';

  beforeEach(() => {
    repo = new TempRepo('release-cli').init();
    origin = join(repo.outside, 'origin.git');
    repo.git('init', '-q', '--bare', origin);
    repo.git('remote', 'add', 'origin', origin);
  });

  afterEach(() => repo.remove());

  it('publishes the released commit to the release branch and its tag, then moves both forward', () => {
    const first = release('0.83.0');
    const run = repo.run(CLI, ['--version', '0.83.0', '--source', first]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, `release: published 0.83.0 as ${first} on release, tagged v0.83.0\n`);
    assert.equal(remote('refs/heads/release'), first);
    assert.equal(remote('refs/tags/v0.83.0'), first);

    const second = release('0.84.0');
    assert.equal(repo.run(CLI, ['--version', '0.84.0', '--source', second]).status, 0);
    assert.equal(remote('refs/heads/release'), second);
    assert.equal(remote('refs/tags/v0.83.0'), first);
  });

  it('changes nothing on a run again for a published release', () => {
    const source = release('0.83.0');
    repo.run(CLI, ['--version', '0.83.0', '--source', source]);
    const again = repo.run(CLI, ['--version', '0.83.0', '--source', source]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout, `release: release and v0.83.0 already hold ${source}, nothing to publish\n`);
  });

  it('refuses to move the branch back to an older release', () => {
    const first = release('0.83.0');
    const second = release('0.84.0');
    repo.run(CLI, ['--version', '0.84.0', '--source', second]);
    repo.git('checkout', '-q', '--detach', first);
    const back = repo.run(CLI, ['--version', '0.83.0', '--source', first]);
    assert.equal(back.status, 2);
    assert.equal(back.stderr, `release: ${first} does not descend from release's ${second}; the branch only moves forward\n`);
    assert.equal(remote('refs/heads/release'), second);
  });

  it('prints its usage without a version or a source', () => {
    const run = repo.run(CLI, ['--version', '0.83.0']);
    assert.equal(run.status, 2);
    assert.match(run.stdout, /^release: pass --version <MAJOR\.MINOR\.PATCH> and --source <main commit sha>/);
  });
});
