import { GitError, type Git } from '../lib/git.ts';
import { isRecord, stringField } from '../lib/guards.ts';

/**
 * Publishes a release to the branch installs read (T4363, teamrig's T4355 for the pane). The pane ships its
 * TypeScript as is, with no build, so a release is main's released commit itself: the `release` branch fast-forwards
 * to it and `v<version>` tags it, so installs read only released commits, never every merge. The branch only moves
 * forward and a tag never moves, and a run again for a release already published changes nothing, so a re-run
 * workflow is safe.
 */

export interface Publication {
  /** The released version, MAJOR.MINOR.PATCH, which the source's plugin.json must name. */
  readonly version: string;
  /** The full sha of main's released commit, checked out here. */
  readonly source: string;
  /** The branch the marketplace entry installs from. */
  readonly branch: string;
  /** The remote both the branch and the tag are pushed to. */
  readonly remote: string;
}

/** The plugin manifest whose version a release names. */
export const PLUGIN_JSON = 'plugins/teamrig-pane/.claude-plugin/plugin.json';

const VERSION = /^\d+\.\d+\.\d+$/;
const SHA = /^[0-9a-f]{40}$/;

/** Why the publication cannot run, or undefined when its fields are well formed. */
export function publicationProblem(publication: Publication): string | undefined {
  if (!VERSION.test(publication.version)) return `the version ${publication.version} is not MAJOR.MINOR.PATCH`;
  if (!SHA.test(publication.source)) return `the source ${publication.source} is not a full commit sha`;
  return undefined;
}

/** The sha a ref has on the remote, or undefined when the remote has no such ref. */
async function remoteSha(git: Git, remote: string, ref: string): Promise<string | undefined> {
  const line = (await git.text(['ls-remote', remote, ref])).split('\n').find((row) => row.endsWith(`\t${ref}`));
  return line?.split('\t')[0];
}

/** The version the plugin.json of `source` names, or undefined when it names none. */
async function versionAt(git: Git, source: string): Promise<string | undefined> {
  const parsed: unknown = JSON.parse(await git.text(['show', `${source}:${PLUGIN_JSON}`]));
  return isRecord(parsed) ? stringField(parsed, 'version') : undefined;
}

/** Whether `older` is `newer` or one of its ancestors; git exits 1 for "no", which is no failure here. */
async function isAncestor(git: Git, older: string, newer: string): Promise<boolean> {
  try {
    await git.text(['merge-base', '--is-ancestor', older, newer]);
    return true;
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}

/**
 * Moves the release branch to the checked-out source and tags it, or finds it done already. Returns the source's
 * sha. Refuses a checkout not at the source, a plugin.json naming another version, a branch the source does not
 * descend from, and a tag that names another commit.
 */
export async function publishRelease(git: Git, publication: Publication, log: (line: string) => void): Promise<string> {
  const problem = publicationProblem(publication);
  if (problem !== undefined) throw new Error(problem);
  const { version, source, branch, remote } = publication;
  const head = (await git.text(['rev-parse', 'HEAD'])).trim();
  if (head !== source) throw new Error(`the checkout is at ${head}, not the release's source ${source}`);
  const named = await versionAt(git, source);
  if (named !== version) throw new Error(`${PLUGIN_JSON} at ${source} names ${named ?? 'no version'}, not ${version}`);

  const tag = `refs/tags/v${version}`;
  const heads = `refs/heads/${branch}`;
  const [last, tagged] = [await remoteSha(git, remote, heads), await remoteSha(git, remote, tag)];
  if (tagged !== undefined && tagged !== source) throw new Error(`v${version} already tags ${tagged}, not ${source}; a tag never moves`);
  if (last !== undefined && last !== source) {
    await git.text(['fetch', '--quiet', '--no-tags', remote, heads]);
    if (!(await isAncestor(git, last, source))) throw new Error(`${source} does not descend from ${branch}'s ${last}; the branch only moves forward`);
  }

  const updates = [...(last === source ? [] : [`${source}:${heads}`]), ...(tagged === source ? [] : [`${source}:${tag}`])];
  if (updates.length === 0) {
    log(`release: ${branch} and v${version} already hold ${source}, nothing to publish`);
    return source;
  }
  await git.text(['push', '--atomic', remote, ...updates]);
  log(`release: published ${version} as ${source} on ${branch}, tagged v${version}`);
  return source;
}
