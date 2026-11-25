import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { runMain } from '../lib/run-main.ts';
import { ARCHIVE_NAME, archiveText, sha256Of } from './archive.ts';
import { builtArchive, outOf, versionOf } from './build.ts';
import { emitUi } from './emit.ts';
import { SPEAKS } from '../../plugins/teamrig-pane/hooks/interface.ts';

/**
 * Emits the dedicated UI (emit.ts), completes the emit's imports and writes the archive `teamrig ui` fetches, printing
 * the sha256 its release pins. Run from the repository root.
 */
async function main(): Promise<number> {
  const root = realpathSync(process.cwd());
  const out = resolve(root, outOf(process.argv.slice(2)));
  const emitted = emitUi(root);
  if (!emitted.ok) {
    console.log(`ui archive: the emit failed (tsc exit ${String(emitted.status)}):`);
    console.log(emitted.output);
    return EXIT_FINDINGS;
  }
  const manifest = readFileSync(join(root, 'plugins', 'teamrig-pane', '.claude-plugin', 'plugin.json'), 'utf8');
  const { archive, completed } = builtArchive({ version: versionOf(manifest), interface: SPEAKS }, emitted.files);
  const text = archiveText(archive);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, ARCHIVE_NAME), text, 'utf8');
  console.log(`ui archive: ${archive.files.length} file(s) of ${archive.version} for interface ${archive.interface}, ${completed} import(s) completed, in ${join(out, ARCHIVE_NAME)}`);
  console.log(`sha256 ${sha256Of(text)}`);
  return EXIT_CLEAN;
}

process.exitCode = await runMain('ui-archive', main, (line) => console.error(line));
