import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { TSC } from '../lib/tsc.ts';

/** What `tsc` emitted of the dedicated UI, by `/`-separated path from the emit's root; or why it emitted nothing. */
export type Emitted =
  | { readonly ok: true; readonly files: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly status: number | null; readonly output: string };

/** Every file under `folder`, by its `/`-separated path from it. */
function filesUnder(folder: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(folder, path).split(sep).join('/'), readFileSync(path, 'utf8'));
  }
  return files;
}

/**
 * Emits the dedicated UI of the checkout at `root` with `tsc` (tsconfig.ui.json) into a folder of its own, read back
 * and removed: what the ui-archive tool packs and the ui-dev tool runs. A `tsc` that could not start has no exit code,
 * and is told the same way as one that failed.
 */
export function emitUi(root: string): Emitted {
  const emit = mkdtempSync(join(tmpdir(), 'teamrig-ui-emit-'));
  try {
    const tsc = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.ui.json', '--outDir', emit], { cwd: root, encoding: 'utf8' });
    if (tsc.status !== 0) {
      return { ok: false, status: tsc.status, output: `${tsc.stdout}${tsc.stderr}`.trimEnd() };
    }
    return { ok: true, files: filesUnder(emit) };
  } finally {
    rmSync(emit, { recursive: true, force: true });
  }
}
