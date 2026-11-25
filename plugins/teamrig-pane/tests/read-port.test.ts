// One run of `teamrig read` (hooks/read-port.ts): every document a poll asks for goes in one run, with the revision
// held of each handed back; a failed or cut run is a failure with its reason and no documents; a document that is
// missing, unreadable or unchanged from nothing held is a named problem beside the ones that were read; a missing CLI
// or a run that does not finish is a failure, never a throw; a failure's reason holds nothing a terminal would act
// on (T4742). A cut run that asked for tasks reads them a page at a time, the pages of one revision joined, again
// from the first page when the revision moves, a bounded number of times (T5464).
import { describe, expect, test } from 'claude-code/testing'
import {
  PAGED_READ_TRIES,
  READ_TIMEOUT_MS,
  TASKS_PAGE_BYTES,
  readDocuments,
  readResult,
  readWords,
  type ReadAsk,
  type ReadAsker,
  type ReadPorts,
} from '../hooks/read-port'
import { CONTROL_SHOWN } from '../hooks/shown-text'
import { cliArgv, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'

const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }
const TASKS = { interface: '1.0', document: 'tasks', revision: 'r7', tasks: [] }
const INBOX = { interface: '1.0', document: 'inbox', revision: 'r2', lines: [] }
const WHOLE: readonly ReadAsk[] = [
  { name: 'tasks', held: null },
  { name: 'inbox', held: null },
]
/** The pane's conversation, in a tab drawing session api, and in one that knows no session. */
const AS_API: ReadAsker = { session: 'api', conversation: 'c-1' }
const UNTIED: ReadAsker = { session: null, conversation: 'c-1' }

function ok(...printed: readonly unknown[]): CliRun {
  return { exitCode: 0, stdout: printed.map(value => JSON.stringify(value)).join('\n'), stderr: '', isStdoutTruncated: false }
}

type Recorded = { runs: { argv: readonly string[]; timeoutMs: number }[] }

/** Ports recording each run; `answer` answers it, an Error by rejecting. */
function portsOf(answer: CliRun | Error): ReadPorts & Recorded {
  const runs: Recorded['runs'] = []
  return {
    runs,
    run: (argv, timeoutMs) => {
      runs.push({ argv, timeoutMs })
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    },
  }
}

describe('readWords', () => {
  test('asks for every document in one run, as JSON, naming the conversation it runs in', () => {
    expect(readWords(WHOLE, UNTIED)).toEqual(['read', 'tasks', 'inbox', '--json', '--conversation', 'c-1'])
  })

  test('a conversation id teamrig would refuse the run for is left out', () => {
    expect(readWords(WHOLE, { session: 'api', conversation: 'c 1;x' })).toEqual(['read', 'tasks', 'inbox', '--json', '--session', 'api'])
    expect(readWords(WHOLE, { session: null, conversation: '' })).toEqual(['read', 'tasks', 'inbox', '--json'])
    expect(readWords(WHOLE, { session: null, conversation: 'c'.repeat(129) })).toEqual(['read', 'tasks', 'inbox', '--json'])
  })

  test('hands back the revisions held in one flag, and asks as the session drawn', () => {
    const asks: readonly ReadAsk[] = [
      { name: 'tasks', held: 'r7' },
      { name: 'inbox', held: null },
      { name: 'config', held: 'c1' },
    ]
    expect(readWords(asks, AS_API)).toEqual(['read', 'tasks', 'inbox', 'config', '--json', '--unless', 'tasks=r7,config=c1', '--session', 'api', '--conversation', 'c-1'])
  })

  test('narrows the documents by each flag given, and by none when given none', () => {
    const stats: readonly ReadAsk[] = [{ name: 'stats', held: null }]
    expect(readWords(stats, UNTIED, { team: 'acme', owner: 'api', range: '90d' })).toEqual([
      'read', 'stats', '--json', '--conversation', 'c-1', '--team', 'acme', '--owner', 'api', '--range', '90d',
    ])
    expect(readWords(stats, UNTIED, { range: 'all' })).toEqual(['read', 'stats', '--json', '--conversation', 'c-1', '--range', 'all'])
    expect(readWords(stats, UNTIED, {})).toEqual(readWords(stats, UNTIED))
  })

  test('with one revision held the flag names it alone', () => {
    expect(readWords([{ name: 'tasks', held: 'r7' }, { name: 'inbox', held: null }], UNTIED)).toEqual(['read', 'tasks', 'inbox', '--json', '--unless', 'tasks=r7', '--conversation', 'c-1'])
  })
})

describe('readResult', () => {
  test('serves each document asked for under its name', () => {
    const result = readResult(ok(TASKS, INBOX), WHOLE)
    expect(result.kind).toBe('read')
    if (result.kind !== 'read') return
    expect([...result.documents.keys()]).toEqual(['tasks', 'inbox'])
    expect(result.documents.get('tasks')?.revision).toBe('r7')
    expect(result.problems).toEqual([])
  })

  test('a failed run is a failure with what it wrote, else its exit code', () => {
    const said: CliRun = { exitCode: 2, stdout: JSON.stringify(TASKS), stderr: 'REFUSED: no team here\n', isStdoutTruncated: false }
    expect(readResult(said, WHOLE)).toEqual({ kind: 'failed', reason: 'REFUSED: no team here' })
    expect(readResult({ ...said, stderr: '' }, WHOLE)).toEqual({ kind: 'failed', reason: 'teamrig read exited 2' })
  })

  test('a failed run is told with nothing in it a terminal would act on', () => {
    const said: CliRun = { exitCode: 2, stdout: '', stderr: '\u001b[31mREFUSED\u001b[0m: no team ‮ereh\n', isStdoutTruncated: false }
    expect(readResult(said, WHOLE)).toEqual({ kind: 'failed', reason: `${CONTROL_SHOWN}[31mREFUSED${CONTROL_SHOWN}[0m: no team ereh` })
  })

  test('a cut answer is a failure, with no document read from its start', () => {
    expect(readResult({ ...ok(TASKS, INBOX), isStdoutTruncated: true }, WHOLE)).toEqual({
      kind: 'failed',
      reason: 'teamrig read printed more than the pane can take in one run',
    })
  })

  test('a document that was not printed is a problem beside the ones read', () => {
    const result = readResult(ok(TASKS), WHOLE)
    expect(result.kind === 'read' ? [...result.documents.keys()] : null).toEqual(['tasks'])
    expect(result.kind === 'read' ? result.problems : null).toEqual(['teamrig read printed no inbox document'])
  })

  test('a line it cannot read is a problem, and its document is told as not printed', () => {
    const result = readResult(ok(TASKS, { ...INBOX, interface: '2.0' }), WHOLE)
    expect(result.kind === 'read' ? result.problems : null).toEqual([
      'teamrig printed interface 2.0, newer than the pane reads: update teamrig-pane',
      'teamrig read printed no inbox document',
    ])
  })

  test('unchanged is taken for a revision held', () => {
    const unchanged = { interface: '1.0', document: 'tasks', revision: 'r7', unchanged: true }
    const result = readResult(ok(unchanged, INBOX), [{ name: 'tasks', held: 'r7' }, { name: 'inbox', held: null }])
    expect(result.kind === 'read' ? result.documents.get('tasks')?.isUnchanged : null).toBe(true)
    expect(result.kind === 'read' ? result.problems : null).toEqual([])
  })

  test('unchanged from nothing held is a problem, told once, never a document', () => {
    const unchanged = { interface: '1.0', document: 'tasks', revision: 'r7', unchanged: true }
    const result = readResult(ok(unchanged, INBOX), WHOLE)
    expect(result.kind === 'read' ? [...result.documents.keys()] : null).toEqual(['inbox'])
    expect(result.kind === 'read' ? result.problems : null).toEqual(['teamrig read answered tasks as unchanged to a read that held none of it'])
  })

  test('a document that was not asked for is left out', () => {
    const result = readResult(ok(TASKS, INBOX), [{ name: 'inbox', held: null }])
    expect(result.kind === 'read' ? [...result.documents.keys()] : null).toEqual(['inbox'])
  })

  test('an answer with nothing to read is a failure that says why', () => {
    expect(readResult(ok(), WHOLE)).toEqual({ kind: 'failed', reason: 'teamrig read printed no document the pane can read: update teamrig' })
    expect(readResult({ ...ok(), stdout: 'READ tasks: 3 open' }, WHOLE)).toEqual({ kind: 'failed', reason: 'teamrig printed a line that is no JSON' })
  })
})

describe('readDocuments', () => {
  test('runs the CLI once for every document, as the asker, within the read timeout', async () => {
    const ports = portsOf(ok(TASKS, INBOX))
    const result = await readDocuments(CLI, ports, WHOLE, AS_API)
    expect(result.kind).toBe('read')
    expect(ports.runs).toEqual([
      { argv: cliArgv(CLI.main, ['read', 'tasks', 'inbox', '--json', '--session', 'api', '--conversation', 'c-1']), timeoutMs: READ_TIMEOUT_MS },
    ])
  })

  test('a tab that knows no session leaves the asker to the CLI, which finds it by the conversation', async () => {
    const ports = portsOf(ok(TASKS, INBOX))
    await readDocuments(CLI, ports, WHOLE, UNTIED)
    expect(ports.runs.map(run => run.argv)).toEqual([cliArgv(CLI.main, ['read', 'tasks', 'inbox', '--json', '--conversation', 'c-1'])])
  })

  test('with nothing to read it runs nothing', async () => {
    const ports = portsOf(ok(TASKS))
    expect(await readDocuments(CLI, ports, [], AS_API)).toEqual({ kind: 'read', documents: new Map(), problems: [] })
    expect(ports.runs).toEqual([])
  })

  test('a missing CLI is a failure with its problem, and nothing runs', async () => {
    const ports = portsOf(ok(TASKS))
    expect(await readDocuments({ kind: 'missing', problem: 'no teamrig command on the PATH' }, ports, WHOLE, AS_API)).toEqual({
      kind: 'failed',
      reason: 'no teamrig command on the PATH',
    })
    expect(ports.runs).toEqual([])
  })

  test('a run that does not finish is a failure, never a throw', async () => {
    expect(await readDocuments(CLI, portsOf(new Error('no answer in 35 s')), WHOLE, AS_API)).toEqual({
      kind: 'failed',
      reason: 'teamrig read did not finish: no answer in 35 s',
    })
  })

  test('a cut run that asked for no tasks stays a failure, with no second run', async () => {
    const ports = portsOf({ ...ok(INBOX), isStdoutTruncated: true })
    expect(await readDocuments(CLI, ports, [{ name: 'inbox', held: null }], AS_API)).toEqual({
      kind: 'failed',
      reason: 'teamrig read printed more than the pane can take in one run',
    })
    expect(ports.runs).toHaveLength(1)
  })

  test('a run that broke is told with nothing in it a terminal would act on', async () => {
    expect(await readDocuments(CLI, portsOf(new Error('spawn \u0007node\u009b ENOENT')), WHOLE, AS_API)).toEqual({
      kind: 'failed',
      reason: `teamrig read did not finish: spawn ${CONTROL_SHOWN}node${CONTROL_SHOWN} ENOENT`,
    })
  })
})

/** Ports answering each run with the next of `answers`, in order; a run past them is a failed run. */
function scriptedPorts(...answers: readonly CliRun[]): ReadPorts & Recorded {
  const runs: Recorded['runs'] = []
  return {
    runs,
    run: (argv, timeoutMs) => {
      const answer = answers[runs.length] ?? { exitCode: 9, stdout: '', stderr: 'no more runs scripted', isStdoutTruncated: false }
      runs.push({ argv, timeoutMs })
      return Promise.resolve(answer)
    },
  }
}

/** A page of tasks at `revision` serving `ids`, naming `next` the task the page after starts after. */
function page(revision: string, ids: readonly string[], next: string | null): Readonly<Record<string, unknown>> {
  return { interface: '1.10', document: 'tasks', revision, tasks: ids.map(id => ({ id })), cuts: [], retired: 4, next }
}

const CUT: CliRun = { ...ok(TASKS, INBOX), isStdoutTruncated: true }
const PAGE_BYTES = String(TASKS_PAGE_BYTES)

/** The ids of the tasks a read served, or the failure it was. */
function servedIds(result: Awaited<ReturnType<typeof readDocuments>>): unknown {
  if (result.kind !== 'read') return result
  const tasks = result.documents.get('tasks')?.fields['tasks']
  return Array.isArray(tasks) ? tasks.map((task: unknown) => (typeof task === 'object' && task !== null && 'id' in task ? task.id : null)) : null
}

describe('readDocuments past one run (T5464)', () => {
  test('a cut run that asked for tasks reads the others in one run and tasks page by page, joined', async () => {
    const ports = scriptedPorts(CUT, ok(INBOX), ok(page('r8', ['T1', 'T2'], 'T2')), ok(page('r8', ['T3'], null)))
    const result = await readDocuments(CLI, ports, WHOLE, AS_API, { owner: 'api' })
    expect(servedIds(result)).toEqual(['T1', 'T2', 'T3'])
    expect(result.kind === 'read' ? [...result.documents.keys()] : null).toEqual(['inbox', 'tasks'])
    expect(result.kind === 'read' ? result.documents.get('tasks')?.fields['next'] : 'none').toBeNull()
    const asker = ['--session', 'api', '--conversation', 'c-1', '--owner', 'api']
    expect(ports.runs.map(run => run.argv)).toEqual([
      cliArgv(CLI.main, ['read', 'tasks', 'inbox', '--json', ...asker]),
      cliArgv(CLI.main, ['read', 'inbox', '--json', ...asker]),
      cliArgv(CLI.main, ['read', 'tasks', '--json', ...asker, '--max-bytes', PAGE_BYTES]),
      cliArgv(CLI.main, ['read', 'tasks', '--json', ...asker, '--max-bytes', PAGE_BYTES, '--after', 'T2']),
    ])
  })

  test('only the first page hands back the revision held, and an unchanged first page is the answer', async () => {
    const unchanged = { interface: '1.10', document: 'tasks', revision: 'r7', unchanged: true }
    const ports = scriptedPorts(CUT, ok(INBOX), ok(unchanged))
    const result = await readDocuments(CLI, ports, [{ name: 'tasks', held: 'r7' }, { name: 'inbox', held: null }], UNTIED)
    expect(result.kind === 'read' ? result.documents.get('tasks')?.isUnchanged : null).toBe(true)
    expect(ports.runs[2]?.argv).toEqual(cliArgv(CLI.main, ['read', 'tasks', '--json', '--unless', 'tasks=r7', '--conversation', 'c-1', '--max-bytes', PAGE_BYTES]))
  })

  test('a page of another revision starts the pages again from the first', async () => {
    const ports = scriptedPorts(
      CUT,
      ok(INBOX),
      ok(page('r8', ['T1'], 'T1')),
      ok(page('r9', ['T2'], null)),
      ok(page('r9', ['T1'], 'T1')),
      ok(page('r9', ['T2', 'T4'], null)),
    )
    expect(servedIds(await readDocuments(CLI, ports, WHOLE, UNTIED))).toEqual(['T1', 'T2', 'T4'])
    expect(ports.runs).toHaveLength(6)
  })

  test('a register that changes between the pages of every try is a failure, after a bounded number of tries', async () => {
    const moving = Array.from({ length: PAGED_READ_TRIES }, (_, attempt) => [ok(page(`a${attempt}`, ['T1'], 'T1')), ok(page(`b${attempt}`, ['T2'], null))]).flat()
    const ports = scriptedPorts(CUT, ok(INBOX), ...moving)
    expect(await readDocuments(CLI, ports, WHOLE, UNTIED)).toEqual({
      kind: 'failed',
      reason: `teamrig read printed more than the pane can take in one run, and reading tasks a page at a time failed: the register changed between its pages ${PAGED_READ_TRIES} times in a row`,
    })
    expect(ports.runs).toHaveLength(2 + 2 * PAGED_READ_TRIES)
  })

  test('a teamrig too old to page is a failure naming its refusal', async () => {
    const refused: CliRun = { exitCode: 2, stdout: '', stderr: 'USAGE: unknown flag --max-bytes\n', isStdoutTruncated: false }
    expect(await readDocuments(CLI, scriptedPorts(CUT, ok(INBOX), refused), WHOLE, UNTIED)).toEqual({
      kind: 'failed',
      reason: 'teamrig read printed more than the pane can take in one run, and reading tasks a page at a time failed: USAGE: unknown flag --max-bytes',
    })
  })

  test('a cursor served twice ends the read as a failure, never a loop', async () => {
    const ports = scriptedPorts(CUT, ok(INBOX), ok(page('r8', ['T1'], 'T1')), ok(page('r8', ['T1'], 'T1')))
    expect(await readDocuments(CLI, ports, WHOLE, UNTIED)).toEqual({
      kind: 'failed',
      reason: 'teamrig read printed more than the pane can take in one run, and reading tasks a page at a time failed: teamrig served the page after T1 twice',
    })
    expect(ports.runs).toHaveLength(4)
  })

  test('a read of tasks alone pages with no other run', async () => {
    const ports = scriptedPorts({ ...ok(TASKS), isStdoutTruncated: true }, ok(page('r8', ['T1'], null)))
    expect(servedIds(await readDocuments(CLI, ports, [{ name: 'tasks', held: null }], UNTIED))).toEqual(['T1'])
    expect(ports.runs).toHaveLength(2)
  })

  test('a failed read of the other documents is the answer, and no page is asked', async () => {
    const refused: CliRun = { exitCode: 2, stdout: '', stderr: 'REFUSED: no team here\n', isStdoutTruncated: false }
    const ports = scriptedPorts(CUT, refused)
    expect(await readDocuments(CLI, ports, WHOLE, UNTIED)).toEqual({ kind: 'failed', reason: 'REFUSED: no team here' })
    expect(ports.runs).toHaveLength(2)
  })
})
