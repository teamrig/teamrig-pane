// Where the person last typed a prompt, in any team on this host: teamrig's prompt hook writes it for each prompt a
// person sent, never for one teamrig submitted to wake a tab (teamrig's src/sessions/last-typed.ts, T5101), as one
// JSON line `{"v":1,"team","session","tab","at"}` in `<kit home>/last-typed.json`, replaced whole. The UI reads it to
// follow the person from session to session; a missing, damaged or other-format file reads as no record.
import { isRecord } from '../hooks/core/core/guards'
import { SESSION_NAME } from '../hooks/core/read/index'
import { TEAM_ID } from '../hooks/places'
import type { Files } from '../hooks/source'

/** The record's format; a file in another reads as none. */
export const LAST_TYPED_FORMAT = 1

/** The last-typed file's name under the kit home. */
export const LAST_TYPED_FILE = 'last-typed.json'

export type LastTyped = {
  readonly team: string
  /** The team session's id. */
  readonly session: string
  /** The AI CLI session of the tab typed in. */
  readonly tab: string
  /** When the prompt was sent, an ISO time: a new prompt gives a new one. */
  readonly at: string
}

function textOf(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

/** The file's record, or null when it is damaged, from another format, or names an id teamrig would refuse. */
export function parseLastTyped(text: string): LastTyped | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed['v'] !== LAST_TYPED_FORMAT) return null
  const team = textOf(parsed, 'team')
  const session = textOf(parsed, 'session')
  const tab = textOf(parsed, 'tab')
  const at = textOf(parsed, 'at')
  if (team === null || session === null || tab === null || at === null) return null
  // Both become part of a path or a pin, so an id teamrig would refuse is no record.
  return TEAM_ID.test(team) && SESSION_NAME.test(session) ? { team, session, tab, at } : null
}

/** The record in `<kitHome>/last-typed.json`; null when there is no kit home, no file or no readable record. */
export async function readLastTyped(files: Pick<Files, 'read'>, kitHome: string | null): Promise<LastTyped | null> {
  if (kitHome === null) return null
  const text = await files.read(`${kitHome}/${LAST_TYPED_FILE}`).catch(() => null)
  return text === null ? null : parseLastTyped(text)
}
