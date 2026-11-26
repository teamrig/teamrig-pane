import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMain } from '../lib/run-main.ts';
import { emitUi } from '../ui-archive/emit.ts';
import { uiDev, type DevPorts } from './dev.ts';

/** This checkout, whatever folder npm runs the tool from. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The real tsc, manifest, child and screen; the run's steps and their failures are dev.ts's, tested there. */
const PORTS: DevPorts = {
  emit: emitUi,
  manifest: (root) => readFileSync(join(root, 'plugins', 'teamrig-pane', '.claude-plugin', 'plugin.json'), 'utf8'),
  start: (run, env) => spawnSync(run.command, run.args, { cwd: run.cwd, env, stdio: 'inherit' }),
  log: console.log.bind(console),
  warn: console.error.bind(console),
};

/**
 * `npm run ui:dev [-- --team <team>] [-- --session <id>]`: builds the dedicated UI of this checkout as the release
 * archive holds it, writes it to `.tmp/ui-dev` and runs it in this terminal under this Node.js (dev.ts), ending as it
 * ends.
 */
process.exitCode = await runMain(
  'ui-dev',
  () => Promise.resolve(uiDev({ root: ROOT, node: process.execPath, words: process.argv.slice(2), env: process.env, cwd: process.cwd() }, PORTS)),
  PORTS.warn,
);
