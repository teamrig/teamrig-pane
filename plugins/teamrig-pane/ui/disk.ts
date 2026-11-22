// The dedicated UI's files, as the dock reads them through the engine's `$.fs` (hooks/register.tsx): a path that is
// not there stamps null; one that is there but cannot be read now (locked, denied) throws, so the
// poll shows why over the last tasks drawn instead of drawing none. It imports no plugin file, so the node test that
// holds it (tools/pane-kit/ui-disk.test.ts) typechecks under the tools' NodeNext project; main.ts hands its ports to
// TeamFront, where they are checked against source.ts Files and teamrig-cli.ts CliFiles.
import { access, readFile, stat } from 'node:fs/promises'

/** A file's change time and size, as source.ts FileStamp holds them. */
export type DiskStamp = { readonly mtimeMs: number; readonly size: number }

/** The codes of a path that is not there: none at it, or a file where a folder was walked through. */
const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

/** Whether `error` says the path is not there. */
export function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  const { code } = error
  return typeof code === 'string' && MISSING_CODES.has(code)
}

/** `call`'s answer, or `missing` when the path is not there; any other failure throws. */
async function unlessMissing<T, M>(call: () => Promise<T>, missing: M): Promise<T | M> {
  try {
    return await call()
  } catch (error) {
    if (isMissing(error)) return missing
    throw error
  }
}

/** The register's files on this machine's disk. */
export const DISK_FILES = {
  stamp: (path: string): Promise<DiskStamp | null> =>
    unlessMissing(async (): Promise<DiskStamp | null> => {
      const stats = await stat(path)
      return stats.isFile() ? { mtimeMs: stats.mtimeMs, size: stats.size } : null
    }, null),
  read: (path: string): Promise<string> => readFile(path, 'utf8'),
} as const

/** What finding the teamrig CLI reads (teamrig-cli.ts findTeamrigCli). */
export const DISK_CLI_FILES = {
  exists: (path: string): Promise<boolean> => access(path).then(() => true, () => false),
  read: (path: string): Promise<string> => readFile(path, 'utf8'),
} as const
