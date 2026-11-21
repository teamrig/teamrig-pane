// The machine's teams a project teamrig is not set up for may join (T4759): the not-set-up view lists them
// (setup-rows.ts), and teamrig names them in its `config` document, which with no team holds the teams to join in
// place of settings (config-document.ts). The setup watch asks for the list at every look (setup.ts), far more often
// than a run of the CLI is worth, so the document is read at the first ask and then once each READ_EVERY_MS: a team
// made on the machine shows within that. The list is only ever teamrig's own: a read that failed (teamrig not
// installed, a run that broke), a document that is missing or cannot be read, or one that names a team for the
// project all keep the last list, which is empty before any, and the kit home's folders are never listed in its
// place. The ids are checked as teamrig names a team and sorted, so a served name that is none is never drawn as
// one. The engine allows $ only at its call sites in a hook, so session.start hands this class ports built from $
// calls rather than $ itself.
import { configOf } from './config-document'
import { READ_EVERY_MS } from './document-source'
import { teamIds } from './places'
import type { ReadAsk, ReadResult } from './read-port'

/** The one document the list is read from, whole each time: an `unchanged` answer would name no team. */
export const SETUP_TEAMS_ASKS: readonly ReadAsk[] = [{ name: 'config', held: null }]

export type SetupTeamsPorts = {
  /** One `teamrig read` of SETUP_TEAMS_ASKS (read-port.ts readDocuments); a run that cannot finish is a failed result, never a throw. */
  read: () => Promise<ReadResult>
  /** The engine's clock, in ms. */
  now: () => number | Promise<number>
}

/** The teams `result` names to join, or null when it names none: a failed read, no readable `config`, or a team's own. */
function servedTeams(result: ReadResult): readonly string[] | null {
  if (result.kind === 'failed') return null
  const document = result.documents.get('config')
  if (document === undefined) return null
  const read = configOf(document)
  if (read.kind === 'unreadable' || read.value.kind === 'team') return null
  return teamIds(read.value.teams)
}

export class SetupTeams {
  private readonly ports: SetupTeamsPorts
  private teams: readonly string[] = []
  /** When the document was last asked for, whatever the answer; null before the first ask. */
  private readAt: number | null = null

  constructor(ports: SetupTeamsPorts) {
    this.ports = ports
  }

  /**
   * The teams to join, by id, sorted. Reads at the first ask and once each READ_EVERY_MS after the last read,
   * failed ones too, so a teamrig that cannot answer is not run at every look.
   */
  async list(): Promise<readonly string[]> {
    const now = await this.ports.now()
    if (this.readAt !== null && now - this.readAt < READ_EVERY_MS) return this.teams
    this.readAt = now
    const served = servedTeams(await this.ports.read())
    if (served !== null) this.teams = served
    return this.teams
  }
}
