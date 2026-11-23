import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeGit } from '../lib/fake-git.ts';
import { GitError } from '../lib/git.ts';
import { PLUGIN_JSON, publicationProblem, publishRelease, type Publication } from './publish.ts';

const SOURCE = 'a'.repeat(40);
const LAST = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
const PUBLICATION: Publication = { version: '0.83.0', source: SOURCE, branch: 'release', remote: 'origin' };

const HEADS = 'ls-remote origin refs/heads/release';
const TAG = 'ls-remote origin refs/tags/v0.83.0';
const SHOW = `show ${SOURCE}:${PLUGIN_JSON}`;
const FETCH = 'fetch --quiet --no-tags origin refs/heads/release';
const ANCESTOR = `merge-base --is-ancestor ${LAST} ${SOURCE}`;

/** A fake git at the source, its plugin.json naming 0.83.0, with the answers each case adds. */
function gitWith(answers: Readonly<Record<string, string | GitError>>): FakeGit {
  return new FakeGit({ 'rev-parse HEAD': `${SOURCE}\n`, [SHOW]: '{"name":"teamrig-pane","version":"0.83.0"}', ...answers });
}

async function publish(git: FakeGit, publication: Publication = PUBLICATION): Promise<{ readonly sha: string; readonly lines: readonly string[] }> {
  const lines: string[] = [];
  const sha = await publishRelease(git, publication, (line) => lines.push(line));
  return { sha, lines };
}

const pushes = (git: FakeGit): readonly string[][] => git.calls.filter((call) => call[0] === 'push');

describe('publicationProblem', () => {
  it('accepts a MAJOR.MINOR.PATCH version and a full sha', () => {
    assert.equal(publicationProblem(PUBLICATION), undefined);
  });

  it('names a version that is not MAJOR.MINOR.PATCH', () => {
    assert.equal(publicationProblem({ ...PUBLICATION, version: 'v0.83.0' }), 'the version v0.83.0 is not MAJOR.MINOR.PATCH');
  });

  it('names a source that is not a full commit sha', () => {
    assert.equal(publicationProblem({ ...PUBLICATION, source: 'abc123' }), 'the source abc123 is not a full commit sha');
  });
});

describe('publishRelease', () => {
  it('makes the branch and the tag at the source on a first release', async () => {
    const git = gitWith({ [HEADS]: '', [TAG]: '', [`push --atomic origin ${SOURCE}:refs/heads/release ${SOURCE}:refs/tags/v0.83.0`]: '' });
    const { sha, lines } = await publish(git);
    assert.equal(sha, SOURCE);
    assert.deepEqual(lines, [`release: published 0.83.0 as ${SOURCE} on release, tagged v0.83.0`]);
    assert.equal(pushes(git).length, 1);
  });

  it('fast-forwards the branch from its last release, which the source descends from', async () => {
    const git = gitWith({
      [HEADS]: `${LAST}\trefs/heads/release\n`,
      [TAG]: '',
      [FETCH]: '',
      [ANCESTOR]: '',
      [`push --atomic origin ${SOURCE}:refs/heads/release ${SOURCE}:refs/tags/v0.83.0`]: '',
    });
    const { lines } = await publish(git);
    assert.deepEqual(lines, [`release: published 0.83.0 as ${SOURCE} on release, tagged v0.83.0`]);
  });

  it('refuses a source that does not descend from the branch, pushing nothing', async () => {
    const git = gitWith({ [HEADS]: `${LAST}\trefs/heads/release\n`, [TAG]: '', [FETCH]: '', [ANCESTOR]: new GitError(['merge-base'], '', new Error('exit 1')) });
    await assert.rejects(publish(git), { message: `${SOURCE} does not descend from release's ${LAST}; the branch only moves forward` });
    assert.deepEqual(pushes(git), []);
  });

  it('passes on a failure that is not git saying no', async () => {
    const git = new FakeGit({ 'rev-parse HEAD': `${SOURCE}\n`, [FETCH]: '' });
    const failing = {
      text: async (args: readonly string[]): Promise<string> => {
        if (args[0] === 'merge-base') throw new Error('spawn git ENOENT');
        if (args[0] === 'show') return '{"version":"0.83.0"}';
        if (args[0] === 'ls-remote') return args[2] === 'refs/heads/release' ? `${LAST}\trefs/heads/release\n` : '';
        return git.text(args);
      },
      bytes: git.bytes.bind(git),
    };
    await assert.rejects(publishRelease(failing, PUBLICATION, () => undefined), { message: 'spawn git ENOENT' });
  });

  it('only tags the source when the branch already holds it', async () => {
    const git = gitWith({ [HEADS]: `${SOURCE}\trefs/heads/release\n`, [TAG]: '', [`push --atomic origin ${SOURCE}:refs/tags/v0.83.0`]: '' });
    await publish(git);
    assert.deepEqual(pushes(git), [['push', '--atomic', 'origin', `${SOURCE}:refs/tags/v0.83.0`]]);
  });

  it('changes nothing when the branch and the tag already hold the source', async () => {
    const git = gitWith({ [HEADS]: `${SOURCE}\trefs/heads/release\n`, [TAG]: `${SOURCE}\trefs/tags/v0.83.0\n` });
    const { sha, lines } = await publish(git);
    assert.equal(sha, SOURCE);
    assert.deepEqual(lines, [`release: release and v0.83.0 already hold ${SOURCE}, nothing to publish`]);
    assert.deepEqual(pushes(git), []);
  });

  it('never moves a tag that names another commit', async () => {
    const git = gitWith({ [HEADS]: '', [TAG]: `${OTHER}\trefs/tags/v0.83.0\n` });
    await assert.rejects(publish(git), { message: `v0.83.0 already tags ${OTHER}, not ${SOURCE}; a tag never moves` });
    assert.deepEqual(pushes(git), []);
  });

  it('refuses a checkout that is not at the source', async () => {
    const git = new FakeGit({ 'rev-parse HEAD': `${OTHER}\n` });
    await assert.rejects(publish(git), { message: `the checkout is at ${OTHER}, not the release's source ${SOURCE}` });
  });

  it("refuses a source whose plugin.json names another version", async () => {
    const git = gitWith({ [SHOW]: '{"version":"0.82.0"}' });
    await assert.rejects(publish(git), { message: `${PLUGIN_JSON} at ${SOURCE} names 0.82.0, not 0.83.0` });
  });

  it('refuses a source whose plugin.json names no version', async () => {
    const git = gitWith({ [SHOW]: '[]' });
    await assert.rejects(publish(git), { message: `${PLUGIN_JSON} at ${SOURCE} names no version, not 0.83.0` });
  });

  it('refuses malformed fields before it runs git', async () => {
    const git = new FakeGit({});
    await assert.rejects(publish(git, { ...PUBLICATION, source: 'main' }), { message: 'the source main is not a full commit sha' });
    assert.deepEqual(git.calls, []);
  });
});
