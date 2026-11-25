/**
 * The dedicated UI of this checkout as a program to run: written out where `teamrig ui` would unpack a release, and
 * started the way `teamrig ui` starts one (teamrig's src/ui/start.ts), so a UI developer runs a local build without a
 * teamrig setting that starts unchecked code (teamrig T5129).
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { UiArchive } from '../ui-archive/archive.ts';

/** Where the build is written, under `.tmp/`, which git ignores; emptied at each run, so no stale script stays. */
export const DEV_OUT = '.tmp/ui-dev';

/** Writes each of `archive`'s files under `folder`, emptied first; returns the entry script's path. */
export function writeBuild(folder: string, archive: Pick<UiArchive, 'entry' | 'files'>): string {
  rmSync(folder, { recursive: true, force: true });
  for (const file of archive.files) {
    const path = join(folder, ...file.path.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.text, 'utf8');
  }
  return join(folder, ...archive.entry.split('/'));
}

export interface DevRun {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/**
 * How the build runs: `node <entry> <words>`, the words after `npm run ui:dev --` (the UI reads `--team` and
 * `--session` and refuses any other), in the folder npm was run from (`INIT_CWD`), as the UI finds its team from the
 * folder it starts in, else in `cwd`. The whole environment goes with it, as the build is the person's own; with no
 * `TEAMRIG_CLI` there, the UI calls the teamrig command on the PATH: the installed CLI.
 */
export function devRun(node: string, entry: string, words: readonly string[], env: NodeJS.ProcessEnv, cwd: string): DevRun {
  const started = env['INIT_CWD'];
  return { command: node, args: [entry, ...words], cwd: started === undefined || started === '' ? cwd : started };
}
