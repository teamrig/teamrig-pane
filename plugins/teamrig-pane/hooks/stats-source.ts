// The Stats tab's source (T1419, T4759): teamrig's `stats` document (stats-document.ts) of the team the tab picks, or
// one session of it, over the range it picks, read in one run of `teamrig read` (read-port.ts). The pane reads no
// register, goals or team file for it: teamrig counts as `teamrig stats` does and serves the tasks behind each count.
// A team the scope can pick is the pane's own or one above it, as the held `sessions` document places them; a read
// serves no other. The revision held is handed back, so teamrig answers `unchanged` from its files' stamps, except
// past the document's `validUntil` (a number counted in days of age moves with the clock alone) and when the team,
// session or range asked moved. It writes the view only when it changed, reading every POLL_MS (live.ts) and only
// while the tab shows; a press reads at once (refresh), and one made during a read runs another after it. A run that
// fails, or a document that cannot be read, draws the numbers last read with why; before any read the view fails.
import type { StatsChoice, StatsList, StatsListPick, StatsScope, StatsView, TeamFolderFailure } from '../types'
import type { StatsRange } from './core/read/index'
import { Held } from './held-document'
import { POLL_MS, type Timer } from './live'
import { readDocuments, type ReadNarrowing, type ReadPorts } from './read-port'
import type { SessionsRead } from './sessions-document'
import { areaListKey } from './stats-areas'
import { statsOf, type StatsRead } from './stats-document'
import type { TeamrigCli } from './teamrig-cli'

/** What the tab picked: the scope, the range, and the Health count or area cell whose tasks it lists (null for none). */
export type StatsPick = { readonly scope: StatsChoice; readonly range: StatsRange; readonly list: StatsListPick | null }

export type StatsPorts = ReadPorts & {
  /** The host's id of the conversation the pane runs in. */
  conversation: () => Promise<string>
  /** The `sessions` document the pane last read, which places the teams above its own; null before one is. */
  sessions: () => SessionsRead | null
  /** True while the pane shows the Stats tab, open (not minimized). */
  isShown: () => Promise<boolean>
  /** The scope and range the tab shows now. */
  choice: () => Promise<StatsPick>
  publish: (view: StatsView) => Promise<void>
  /** The time now, epoch ms. */
  now: () => Promise<number>
}

/** The view of a read that has numbers to draw. */
type Shown = Extract<StatsView, { kind: 'stats' }>

/**
 * The teams a scope can pick, the root first: `own` and the teams above it, as `sessions` places them. A parent the
 * document lists no row of ends the walk there; a loop it might hold ends at the first team met again.
 */
export function teamsOf(own: string, sessions: SessionsRead | null): string[] {
  const parents = new Map((sessions?.teams ?? []).map(team => [team.id, team.parent]))
  const teams: string[] = []
  let team: string | null | undefined = own
  while (team !== null && team !== undefined && !teams.includes(team)) {
    teams.unshift(team)
    team = parents.get(team)
  }
  return teams
}

/** The scope as it is read: the tree, or a team no longer above the pane's, reads the pane's own team. */
export function scopeIn(choice: StatsChoice, own: string, teams: readonly string[]): StatsScope {
  return choice.kind !== 'tree' && teams.includes(choice.team) ? choice : { kind: 'team', team: own }
}

/** The flags that read `scope` over `range`: `--team` only for a team above the pane's own, `--owner` for a session. */
export function narrowingOf(scope: StatsScope, range: StatsRange, own: string): ReadNarrowing {
  return {
    ...(scope.team === own ? {} : { team: scope.team }),
    ...(scope.kind === 'session' ? { owner: scope.session } : {}),
    range,
  }
}

/** The list a press picked, its rows from the document: a Health count's, or an area cell's (none when the cell is gone). */
function listOf(pick: StatsListPick | null, read: StatsRead): StatsList | null {
  if (pick === null) return null
  if (typeof pick === 'string') return { kind: pick, rows: read.lists[pick] }
  return { kind: 'area', area: pick, rows: read.areaLists.get(areaListKey(pick)) ?? [] }
}

/** The document held for one team, session and range: a move of any reads anew, holding no revision. */
type Asked = { readonly key: string; readonly document: Held<StatsRead> }

/** Reads the picked scope's stats again while the Stats tab shows, and writes them when they changed. */
export class LiveStats {
  private readonly cli: TeamrigCli
  /** The pane's own team. */
  private readonly team: string
  private readonly ports: StatsPorts
  private asked: Asked | null = null
  private timers: Timer[] = []
  private isRefreshing = false
  /** True when a refresh was asked while one ran: the running one reads again, so the press is not lost. */
  private isAsked = false
  /** The view last written, as JSON: a read that finds the same numbers writes nothing. */
  private shown: string | null = null

  constructor(cli: TeamrigCli, team: string, ports: StatsPorts) {
    this.cli = cli
    this.team = team
    this.ports = ports
  }

  startTimers(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(POLL_MS, () => void this.poll())]
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  /** Reads the stats again, when the tab shows. */
  async poll(): Promise<void> {
    try {
      if (await this.ports.isShown()) await this.refresh()
    } catch {
      // The next poll asks again.
    }
  }

  /** Reads the stats again and writes them when they changed; asked during a read, it reads again after that one. */
  async refresh(): Promise<void> {
    if (this.isRefreshing) {
      this.isAsked = true
      return
    }
    this.isRefreshing = true
    try {
      do {
        this.isAsked = false
        await this.write()
      } while (this.isAsked)
    } finally {
      this.isRefreshing = false
    }
  }

  private async write(): Promise<void> {
    try {
      const view = await this.read(await this.ports.choice(), await this.ports.now())
      const json = JSON.stringify(view)
      if (json !== this.shown) {
        await this.ports.publish(view)
        this.shown = json
      }
    } catch {
      // A failed write is written by the next refresh, which finds the view still unwritten.
    }
  }

  /** The picked scope's stats as teamrig serves them now, or as last read with why a newer read failed. */
  private async read(pick: StatsPick, now: number): Promise<StatsView> {
    const teams = teamsOf(this.team, this.ports.sessions())
    const scope = scopeIn(pick.scope, this.team, teams)
    const narrowing = narrowingOf(scope, pick.range, this.team)
    const asked = this.heldFor(scope.team, JSON.stringify(narrowing))
    const held = asked.document
    const isStale = held.value !== null && now >= held.value.validUntil
    const result = await readDocuments(
      this.cli,
      this.ports,
      [{ name: 'stats', held: isStale ? null : held.revision }],
      { session: null, conversation: await this.ports.conversation() },
      narrowing,
    )
    if (result.kind === 'read') {
      const document = result.documents.get('stats')
      if (document !== undefined) held.take(document)
    }
    const failed = result.kind === 'failed' ? [result.reason] : result.problems
    const lines = [...failed, ...held.lines]
    const value = held.value
    if (value === null) return { kind: 'failed', reason: lines.join('; ') || 'teamrig served no stats document' }
    const isLastRead = result.kind === 'failed' || held.trouble !== null || !result.documents.has('stats')
    const failures: TeamFolderFailure[] = lines.length === 0 ? [] : [{ team: scope.team, reason: lines.join('; '), isLastRead }]
    const view: Shown = { kind: 'stats', scope, range: pick.range, teams, stats: value.stats, health: value.health, list: listOf(pick.list, value), week: null, failures }
    return view
  }

  /** The document held for `key`, a new one when the team, session or range asked moved. */
  private heldFor(team: string, key: string): Asked {
    if (this.asked?.key === key) return this.asked
    const made: Asked = { key, document: new Held(document => statsOf(document, team)) }
    this.asked = made
    return made
  }
}
