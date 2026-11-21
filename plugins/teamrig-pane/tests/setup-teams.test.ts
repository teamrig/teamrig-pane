// The teams a project teamrig is not set up for may join (hooks/setup-teams.ts): read from teamrig's `config`
// document at the first ask and once each READ_EVERY_MS, and kept as last served through a read that names none.
import { describe, expect, test } from 'claude-code/testing'
import { READ_EVERY_MS } from '../hooks/document-source'
import { readResult, type ReadResult } from '../hooks/read-port'
import { SETUP_TEAMS_ASKS, SetupTeams } from '../hooks/setup-teams'
import { NOW } from './fixtures'
import { configDocument, printed, refused, sessionsDocument } from './served-documents'

/** What teamrig answers a project with no team, on a machine holding `teams`. */
function noTeam(teams: readonly string[]): ReadResult {
  return readResult(printed(configDocument('c1', { team: null, teams })), SETUP_TEAMS_ASKS)
}

/** The list over answers the test queues (the last one repeats) and a clock it moves; `reads` counts the runs. */
function listOver(...answers: readonly ReadResult[]) {
  const stand = { now: NOW, reads: 0 }
  const teams = new SetupTeams({
    read: () => {
      const answer = answers[Math.min(stand.reads, answers.length - 1)]
      stand.reads += 1
      if (answer === undefined) throw new Error('listOver needs an answer')
      return Promise.resolve(answer)
    },
    now: () => stand.now,
  })
  return { stand, teams }
}

describe('SetupTeams', () => {
  test('asks for the config document whole', () => {
    expect(SETUP_TEAMS_ASKS).toEqual([{ name: 'config', held: null }])
  })

  test('the first ask reads the teams teamrig serves', async () => {
    const { stand, teams } = listOver(noTeam(['ops', 'web']))
    expect(await teams.list()).toEqual(['ops', 'web'])
    expect(stand.reads).toBe(1)
  })

  test('an ask inside READ_EVERY_MS of the last read runs none, and the first past it reads again', async () => {
    const { stand, teams } = listOver(noTeam(['web']), noTeam(['ops', 'web']))
    await teams.list()
    stand.now = NOW + READ_EVERY_MS - 1
    expect(await teams.list()).toEqual(['web'])
    expect(stand.reads).toBe(1)
    stand.now = NOW + READ_EVERY_MS
    expect(await teams.list()).toEqual(['ops', 'web'])
    expect(stand.reads).toBe(2)
    stand.now = NOW + 2 * READ_EVERY_MS - 1
    await teams.list()
    expect(stand.reads).toBe(2)
  })

  test('served names that are no team id are left out, and the rest sorted', async () => {
    const { teams } = listOver(noTeam(['web', 'Not A Team', '', 'ops', '../up', 'a1-b']))
    expect(await teams.list()).toEqual(['a1-b', 'ops', 'web'])
  })

  test('a failed read lists none before any list was served, and is not run again inside READ_EVERY_MS', async () => {
    const { stand, teams } = listOver(readResult(refused('no such command'), SETUP_TEAMS_ASKS))
    expect(await teams.list()).toEqual([])
    stand.now = NOW + READ_EVERY_MS - 1
    expect(await teams.list()).toEqual([])
    expect(stand.reads).toBe(1)
  })

  test('a failed read keeps the last list, and the next good one replaces it', async () => {
    const { stand, teams } = listOver(noTeam(['web']), { kind: 'failed', reason: 'teamrig read did not finish' }, noTeam([]))
    await teams.list()
    stand.now = NOW + READ_EVERY_MS
    expect(await teams.list()).toEqual(['web'])
    stand.now = NOW + 2 * READ_EVERY_MS
    expect(await teams.list()).toEqual([])
    expect(stand.reads).toBe(3)
  })

  test('a read with no config document, or one that cannot be read, keeps the last list', async () => {
    const other = readResult(printed(sessionsDocument('s1')), [{ name: 'sessions', held: null }])
    const unreadable = readResult(printed(configDocument('c2', { team: null, teams: 'web' })), SETUP_TEAMS_ASKS)
    const { stand, teams } = listOver(noTeam(['web']), other, unreadable)
    await teams.list()
    stand.now = NOW + READ_EVERY_MS
    expect(await teams.list()).toEqual(['web'])
    stand.now = NOW + 2 * READ_EVERY_MS
    expect(await teams.list()).toEqual(['web'])
    expect(stand.reads).toBe(3)
  })

  test("a team's own config document keeps the last list", async () => {
    const { stand, teams } = listOver(noTeam(['web']), readResult(printed(configDocument('c3', { teams: ['ops'] })), SETUP_TEAMS_ASKS))
    await teams.list()
    stand.now = NOW + READ_EVERY_MS
    expect(await teams.list()).toEqual(['web'])
  })

  test('the clock may answer later', async () => {
    const teams = new SetupTeams({ read: () => Promise.resolve(noTeam(['web'])), now: () => Promise.resolve(NOW) })
    expect(await teams.list()).toEqual(['web'])
  })
})
