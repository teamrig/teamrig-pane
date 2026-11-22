// The register as the refresher drives it (T4760): the tasks list, inbox, teams' leads and owner cards are drawn
// from the `tasks`, `sessions`, `config`, `inbox` and `plan` documents, so a frame marking one of them reads the
// register again (live.ts) through the document source (document-source.ts), which hands back what it holds. The
// register also folds the team's files beneath the documents (work marks, spend), which no frame marks, so it keeps
// the refresher's tick (`polls`). The stream follows as whoever the source last asked as; once the source asks as
// another session or conversation (a pin, the area found, a /clear), the stream is followed again so the inbox it
// marks is the one drawn. Runs nothing itself.
import type { ReadAsker } from './read-port'
import type { Subject } from './refresher'

/** The documents the register draws from, by the names `teamrig events` takes. */
export const REGISTER_DOCUMENTS: readonly string[] = ['tasks', 'sessions', 'config', 'inbox', 'plan']

/** Who a follower asks as before the source has asked anything: no session, no conversation. */
export const NO_ASKER: ReadAsker = { session: null, conversation: '' }

/** What the register's reader tells of what it holds (document-source.ts). */
export type HeldDocuments = {
  heldRevision(document: string): string | null
  readonly asker: ReadAsker | null
}

function isSameAsker(a: ReadAsker, b: ReadAsker): boolean {
  return a.session === b.session && a.conversation === b.conversation
}

/** Who the stream was followed as, against who the source asks as now. */
export class FollowedAsker {
  private readonly documents: HeldDocuments
  /** Who the newest follower asks as; null before one started. */
  private followed: ReadAsker | null = null

  constructor(documents: HeldDocuments) {
    this.documents = documents
  }

  /** Who a follower starting now asks as, kept as the one followed. */
  take(): ReadAsker {
    const asker = this.documents.asker ?? NO_ASKER
    this.followed = asker
    return asker
  }

  /** True when a follower started and the source has asked as another since. */
  hasMoved(): boolean {
    const followed = this.followed
    return followed !== null && !isSameAsker(followed, this.documents.asker ?? NO_ASKER)
  }
}

export type RegisterSubjectPorts = {
  /** Reads the register again and draws it; answers whether the read worked (live.ts). */
  readonly refresh: () => Promise<boolean>
  readonly documents: HeldDocuments
  readonly asker: FollowedAsker
  /** Follows the stream again at once, as the refresher's `refollow`. */
  readonly refollow: () => void
}

/** Follows the stream again when the source asks as another than the follower does; for a read outside the refresher too (a pin). */
export function refollowIfMoved(ports: Pick<RegisterSubjectPorts, 'asker' | 'refollow'>): void {
  if (ports.asker.hasMoved()) ports.refollow()
}

export function registerSubject(ports: RegisterSubjectPorts): Subject {
  return {
    documents: REGISTER_DOCUMENTS,
    polls: true,
    // The register feeds the band and the status line as well as the views, so it is read whatever view shows.
    isShown: () => Promise.resolve(true),
    held: document => ports.documents.heldRevision(document),
    refresh: async () => {
      const hasRead = await ports.refresh()
      refollowIfMoved(ports)
      return hasRead
    },
  }
}
