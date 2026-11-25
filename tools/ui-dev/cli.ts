import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_FINDINGS } from '../lib/exit.ts';
import { runMain } from '../lib/run-main.ts';
import { builtArchive, versionOf } from '../ui-archive/build.ts';
import { emitUi } from '../ui-archive/emit.ts';
import { SPEAKS } from '../../plugins/teamrig-pane/hooks/interface.ts';
import { DEV_OUT, devRun, writeBuild } from './dev.ts';

/** This checkout, whatever folder npm runs the tool from. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * `npm run ui:dev [-- --team <team>] [-- --session <id>]`: builds the dedicated UI of this checkout as the release
 * archive holds it, writes it to `.tmp/ui-dev` and runs it in this terminal under this Node.js (dev.ts), ending as it
 * ends.
 */
async function main(): Promise<number> {
  const emitted = emitUi(ROOT);
  if (!emitted.ok) {
    console.log(`ui dev: the emit failed (tsc exit ${String(emitted.status)}):`);
    console.log(emitted.output);
    return EXIT_FINDINGS;
  }
  const manifest = readFileSync(join(ROOT, 'plugins', 'teamrig-pane', '.claude-plugin', 'plugin.json'), 'utf8');
  const { archive } = builtArchive({ version: versionOf(manifest), interface: SPEAKS }, emitted.files);
  const entry = writeBuild(join(ROOT, DEV_OUT), archive);
  const run = devRun(process.execPath, entry, process.argv.slice(2), process.env, process.cwd());
  const ended = spawnSync(run.command, run.args, { cwd: run.cwd, env: process.env, stdio: 'inherit' });
  if (ended.error !== undefined) {
    console.error(`ui dev: ${run.command} did not start: ${ended.error.message}`);
    return EXIT_FINDINGS;
  }
  return ended.status ?? EXIT_FINDINGS;
}

process.exitCode = await runMain('ui-dev', main, (line) => console.error(line));
