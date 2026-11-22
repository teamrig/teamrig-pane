// The Stats tab's source (hooks/stats-source.ts): one `teamrig read stats` run per read, narrowed to the team the scope
// picks when it is above the pane's, to a session by --owner, and to the range; the revision held handed back, except
// past validUntil and when the team, session or range moved; the teams to pick the pane's own and those above it, as
// the held sessions document places them; written only when it changed, read only while the tab shows; a press during
// a read reads again after it; a failed run or an unreadable document drawn as last read with why, before any read a
// failed view (T4759).
import { describe, expect, test } from 'claude-code/testing'
import type { StatsChoice, StatsView } from '../types'
import { POLL_MS } from '../hooks/live'
import { parseDocument, type JsonRecord } from '../hooks/read-document'
import type { SessionsRead } from '../hooks/sessions-document'
import { areaListKey } from '../hooks/stats-areas'
import { statsOf, type StatsRead } from '../hooks/stats-document'
import { LiveStats, narrowingOf, scopeIn, teamsOf, type StatsPick } from '../hooks/stats-source'
import type { CliRun, TeamrigCli } from '../hooks/teamrig-cli'
import { HOUR, NOW } from './fixtures'
import { areaCell, printed, refused, statsArea, statsDocument, statsTask } from './served-documents'

const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }
const CONVERSATION = 'c-1'
/** The pane's team, shop, under acme. */
const TREE: SessionsRead = {
  self: null,
  teams: [
    { id: 'acme', parent: null, active: 1, retired: 0 },
    { id: 'shop', parent: 'acme', active: 3, retired: 0 },
    { id: 'tools', parent: 'shop', active: 1, retired: 0 },
  ],
  sessions: [],
  failures: [],
}
const WHOLE: StatsPick = { scope: { kind: 'tree' }, range: '30d', list: null }
const SHOP: StatsChoice = { kind: 'team', team: 'shop' }

/** One run as the fake teamrig was asked it: the documents, and each flag's word. */
type Asked = { readonly words: readonly string[] }

function flag(asked: Asked, name: string): string | null {
  const at = asked.words.indexOf(name)
  return at < 0 ? null : (asked.words[at + 1] ?? null)
}

/** What the reader makes of `document`; fails the test on one it could not read. */
function readOf(document: JsonRecord, team: string): StatsRead {
  const parsed = parseDocument(document)
  if (parsed.kind !== 'document') throw new Error(`the fixture is no document: ${parsed.kind}`)
  const read = statsOf(parsed.document, team)
  if (read.kind !== 'read') throw new Error(read.reason)
  return read.value
}

/** The view of `document` read for `scope` over `pick`. */
function shown(document: JsonRecord, scope: Exclude<StatsChoice, { kind: 'tree' }>, pick: StatsPick, over: Partial<Extract<StatsView, { kind: 'stats' }>> = {}): StatsView {
  const read = readOf(document, scope.team)
  return { kind: 'stats', scope, range: pick.range, teams: ['acme', 'shop'], stats: read.stats, health: read.health, list: null, week: null, failures: [], ...over }
}

/**
 * A LiveStats over a fake teamrig whose answers the test queues (the last one repeats), with whether the tab shows,
 * the tab's pick, the sessions held and the clock's now set by the test, each run it was asked and each write it made.
 * A closed gate holds `choice` (after it took the pick) until it opens.
 */
function fakeStats(cli: TeamrigCli = CLI) {
  const answers: (CliRun | Error)[] = [printed(statsDocument('s1'))]
  const runs: Asked[] = []
  const shownTab = { tab: true }
  const clock = { now: NOW }
  const pick: { value: StatsPick } = { value: WHOLE }
  const sessions: { read: SessionsRead | null } = { read: TREE }
  const gate: { held: Promise<void> | null } = { held: null }
  const views: StatsView[] = []
  const writes = { fail: false }
  const live = new LiveStats(cli, 'shop', {
    run: async argv => {
      runs.push({ words: argv.slice(argv.indexOf('read') + 1) })
      const answer = answers.length > 1 ? answers.shift() : answers[0]
      if (answer === undefined) throw new Error('no answer queued')
      if (answer instanceof Error) throw answer
      return answer
    },
    conversation: async () => CONVERSATION,
    sessions: () => sessions.read,
    isShown: async () => shownTab.tab,
    choice: async () => {
      const value = pick.value
      if (gate.held !== null) await gate.held
      return value
    },
    publish: async view => {
      if (writes.fail) throw new Error('write refused')
      views.push(view)
    },
    now: async () => clock.now,
  })
  return { live, answers, runs, shown: shownTab, clock, pick, sessions, gate, views, writes }
}

describe('teamsOf', () => {
  test("lists the pane's team and the teams above it, the root first, never a team below", () => {
    expect(teamsOf('shop', TREE)).toEqual(['acme', 'shop'])
    expect(teamsOf('acme', TREE)).toEqual(['acme'])
  })

  test('with no sessions held, or its team not listed, it is the own team alone; a loop ends at the team met again', () => {
    expect(teamsOf('shop', null)).toEqual(['shop'])
    expect(teamsOf('else', TREE)).toEqual(['else'])
    const loop: SessionsRead = { ...TREE, teams: [{ id: 'a', parent: 'b', active: 0, retired: 0 }, { id: 'b', parent: 'a', active: 0, retired: 0 }] }
    expect(teamsOf('a', loop)).toEqual(['b', 'a'])
  })
})

describe('scopeIn and narrowingOf', () => {
  test("the tree, or a team the pane cannot read, reads the pane's own team", () => {
    expect(scopeIn({ kind: 'tree' }, 'shop', ['acme', 'shop'])).toEqual(SHOP)
    expect(scopeIn({ kind: 'team', team: 'tools' }, 'shop', ['acme', 'shop'])).toEqual(SHOP)
    expect(scopeIn({ kind: 'session', team: 'gone', session: 'x' }, 'shop', ['acme', 'shop'])).toEqual(SHOP)
    expect(scopeIn({ kind: 'team', team: 'acme' }, 'shop', ['acme', 'shop'])).toEqual({ kind: 'team', team: 'acme' })
  })

  test('names --team only for a team above, --owner for a session, and the range always', () => {
    expect(narrowingOf(SHOP, '7d', 'shop')).toEqual({ range: '7d' })
    expect(narrowingOf({ kind: 'team', team: 'acme' }, 'all', 'shop')).toEqual({ team: 'acme', range: 'all' })
    expect(narrowingOf({ kind: 'session', team: 'shop', session: 'api' }, '90d', 'shop')).toEqual({ owner: 'api', range: '90d' })
    expect(narrowingOf({ kind: 'session', team: 'acme', session: 'boss' }, '1y', 'shop')).toEqual({ team: 'acme', owner: 'boss', range: '1y' })
  })
})

describe('LiveStats', () => {
  test("reads the own team's stats in one run over the range, as the pane's conversation, and draws what teamrig counted", async () => {
    const { live, runs, views } = fakeStats()
    await live.refresh()
    expect(runs.map(run => run.words)).toEqual([['stats', '--json', '--conversation', CONVERSATION, '--range', '30d']])
    expect(views).toEqual([shown(statsDocument('s1'), SHOP, WHOLE)])
  })

  test("a session's scope reads its tasks by --owner, a team above by --team; each move reads anew, holding no revision", async () => {
    const { live, runs, pick, views } = fakeStats()
    await live.refresh()
    const api: StatsPick = { scope: { kind: 'session', team: 'shop', session: 'api' }, range: '30d', list: null }
    pick.value = api
    await live.refresh()
    const acme: StatsPick = { scope: { kind: 'team', team: 'acme' }, range: '7d', list: null }
    pick.value = acme
    await live.refresh()
    expect(runs.map(run => [flag(run, '--owner'), flag(run, '--team'), flag(run, '--range'), flag(run, '--unless')])).toEqual([
      [null, null, '30d', null],
      ['api', null, '30d', null],
      [null, 'acme', '7d', null],
    ])
    expect(views.at(-1)).toEqual(shown(statsDocument('s1'), { kind: 'team', team: 'acme' }, acme))
  })

  test('hands the revision held back, and an unchanged answer writes nothing; past validUntil it reads whole', async () => {
    const { live, answers, runs, clock, views } = fakeStats()
    await live.refresh()
    answers.splice(0, answers.length, printed({ interface: '1.6', document: 'stats', revision: 's1', unchanged: true, problems: [] }))
    await live.refresh()
    expect(flag(runs[1] ?? { words: [] }, '--unless')).toBe('stats=s1')
    expect(views.length).toBe(1)

    clock.now = NOW + HOUR
    answers.splice(0, answers.length, printed(statsDocument('s2', { opened: 4 })))
    await live.refresh()
    expect(flag(runs[2] ?? { words: [] }, '--unless')).toBe(null)
    expect(views.at(-1)).toEqual(shown(statsDocument('s2', { opened: 4 }), SHOP, WHOLE))
  })

  test("a Health tile's pick lists the tasks behind its count from the document held; an area cell's lists its tasks", async () => {
    const area = { team: 'shop', session: 'api', measure: 'bugs' } as const
    const document = statsDocument('s1', {
      tasks: [statsTask('T1'), statsTask('T2', { priority: 1 })],
      areas: { teams: { areas: [], median: { bugs: 0, p1: 0, p1Late: 0, low: 0, waits: 0, active: 0 } }, sessions: { areas: [statsArea('api', { bugs: areaCell(['T2']) })], median: { bugs: 0, p1: 0, p1Late: 0, low: 0, waits: 0, active: 0 } } },
    })
    const { live, answers, pick, views } = fakeStats()
    answers.splice(0, answers.length, printed(document))
    pick.value = { ...WHOLE, list: 'active' }
    await live.refresh()
    const read = readOf(document, 'shop')
    expect(views.at(-1)).toEqual(shown(document, SHOP, pick.value, { list: { kind: 'active', rows: read.lists.active } }))

    pick.value = { ...WHOLE, list: area }
    await live.refresh()
    expect(views.at(-1)).toEqual(shown(document, SHOP, pick.value, { list: { kind: 'area', area, rows: read.areaLists.get(areaListKey(area)) ?? [] } }))
    expect(read.areaLists.get(areaListKey(area))?.map(row => row.id)).toEqual(['T2'])
  })

  test('a failed run before any read fails the view; after one it draws the numbers last read, named with why', async () => {
    const { live, answers, views } = fakeStats()
    answers.splice(0, answers.length, refused('no team here'))
    await live.refresh()
    expect(views).toEqual([{ kind: 'failed', reason: 'REFUSED no team here' }])

    answers.splice(0, answers.length, printed(statsDocument('s1')), refused('busy'))
    await live.refresh()
    await live.refresh()
    expect(views.at(-1)).toEqual(shown(statsDocument('s1'), SHOP, WHOLE, { failures: [{ team: 'shop', reason: 'REFUSED busy', isLastRead: true }] }))
  })

  test('an unreadable document keeps the numbers last read with why; a missing CLI fails the view', async () => {
    const { live, answers, views } = fakeStats()
    await live.refresh()
    answers.splice(0, answers.length, printed(statsDocument('s2', { opened: '1' })))
    await live.refresh()
    expect(views.at(-1)).toEqual(
      shown(statsDocument('s1'), SHOP, WHOLE, { failures: [{ team: 'shop', reason: "teamrig's stats document cannot be read (opened): update teamrig", isLastRead: true }] }),
    )

    const missing = fakeStats({ kind: 'missing', problem: 'teamrig is not installed' })
    await missing.live.refresh()
    expect(missing.views).toEqual([{ kind: 'failed', reason: 'teamrig is not installed' }])
    expect(missing.runs).toEqual([])
  })

  test('a poll reads only while the tab shows; a write that failed is made by the next refresh', async () => {
    const { live, runs, shown: tab, views, writes } = fakeStats()
    tab.tab = false
    await live.poll()
    expect([views.length, runs.length]).toEqual([0, 0])

    tab.tab = true
    writes.fail = true
    await live.poll()
    expect(views.length).toBe(0)

    writes.fail = false
    await live.refresh()
    expect(views).toEqual([shown(statsDocument('s1'), SHOP, WHOLE)])
  })

  test('a refresh asked while one reads runs again after it, so a press during a poll is not lost', async () => {
    const { live, pick, gate, views } = fakeStats()
    let open = () => {}
    gate.held = new Promise<void>(resolve => {
      open = resolve
    })
    const first = live.refresh()
    const week: StatsPick = { ...WHOLE, range: '7d' }
    pick.value = week
    gate.held = null
    await live.refresh()
    expect(views).toEqual([])

    open()
    await first
    expect(views).toEqual([shown(statsDocument('s1'), SHOP, WHOLE), shown(statsDocument('s1'), SHOP, week)])
  })

  test('its timer polls every POLL_MS until stopped', async () => {
    const { live, views } = fakeStats()
    const timers: { ms: number; fn: () => void; cancelled: boolean }[] = []
    live.startTimers((ms, fn) => {
      const timer = { ms, fn, cancelled: false }
      timers.push(timer)
      return { cancel: () => (timer.cancelled = true) }
    })
    expect(timers.map(timer => timer.ms)).toEqual([POLL_MS])
    timers[0]?.fn()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(views.length).toBe(1)
    live.stop()
    expect(timers[0]?.cancelled).toBe(true)
  })
})
