/**
 * The dedicated UI of this checkout as a program to run: written out where `teamrig ui` would unpack a release, and
 * started the way `teamrig ui` starts one (teamrig's src/ui/start.ts), so a UI developer runs a local build without a
 * teamrig setting that starts unchecked code (teamrig T5129).
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EXIT_FINDINGS } from '../lib/exit.ts';
import type { UiArchive } from '../ui-archive/archive.ts';
import { builtArchive, versionOf } from '../ui-archive/build.ts';
import type { Emitted } from '../ui-archive/emit.ts';
import { SPEAKS } from '../../plugins/teamrig-pane/hooks/interface.ts';

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

/** How a started build ended: the error it never started on, else its exit code (null when a signal ended it). */
export interface Ended {
  readonly error?: Error;
  readonly status: number | null;
}

/** What a ui dev run reaches outside itself: tsc, the plugin manifest, the child it starts and the person's screen. */
export interface DevPorts {
  readonly emit: (root: string) => Emitted;
  readonly manifest: (root: string) => string;
  readonly start: (run: DevRun, env: NodeJS.ProcessEnv) => Ended;
  readonly log: (line: string) => void;
  readonly warn: (line: string) => void;
}

/** The run's own facts: the checkout, this Node.js, the words after `--`, the environment and the folder run from. */
export interface DevCall {
  readonly root: string;
  readonly node: string;
  readonly words: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

/**
 * Builds the dedicated UI of the checkout at `call.root` as the release archive holds it, writes it to DEV_OUT and
 * runs it, ending with its exit code: EXIT_FINDINGS when the emit failed, the build did not start, or a signal ended it.
 */
export function uiDev(call: DevCall, ports: DevPorts): number {
  const emitted = ports.emit(call.root);
  if (!emitted.ok) {
    ports.log(`ui dev: the emit failed (tsc exit ${String(emitted.status)}):`);
    ports.log(emitted.output);
    return EXIT_FINDINGS;
  }
  const { archive } = builtArchive({ version: versionOf(ports.manifest(call.root)), interface: SPEAKS }, emitted.files);
  const entry = writeBuild(join(call.root, DEV_OUT), archive);
  const run = devRun(call.node, entry, call.words, call.env, call.cwd);
  const ended = ports.start(run, call.env);
  if (ended.error !== undefined) {
    ports.warn(`ui dev: ${run.command} did not start: ${ended.error.message}`);
    return EXIT_FINDINGS;
  }
  return ended.status ?? EXIT_FINDINGS;
}
