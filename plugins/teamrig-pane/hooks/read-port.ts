// One run of `teamrig read` for the documents a poll needs (T4742). Starting the CLI costs far more than a file stamp
// (about half a second here, before any work), so a poll asks for all its documents in one run and hands back the
// revision it holds of each: teamrig answers `unchanged` for those without building them. The run's answer is all or
// nothing where the pane could be misled: a failed run, or one whose output the engine cut (teamrig-cli.ts CliRun), is
// a failure with its reason, never documents read from part of it. Past that each document stands alone: one that is
// missing or cannot be read is named as a problem and the others are served, so the pane keeps what it last drew of
// the missing one. A failure's reason may quote what the run wrote to stderr or how it broke: that is another
// program's text as much as a document is, so every reason leaves here as the pane may draw it (shown-text.ts).
// A register can outgrow one run (T5464): when the engine cut a run that asked for `tasks`, the other documents are
// read again in one run and `tasks` a page at a time (interface 1.10's `--max-bytes`), the pages joined when all
// carry one revision. The one run comes first so a small register, or one unchanged since the revision held, still
// costs one run, and a teamrig too old to page fails as it did, its refusal named.
// Runs the CLI only; no model calls.
import type { StatsRange } from './core/read/index'
import { messageOf } from './errors'
import { readAnswer, type DocumentName, type ReadDocument } from './read-document'
import { shownText } from './shown-text'
import { joinedPages, nextOf } from './tasks-pages'
import { cliArgv, failureLines, type CliRun, type TeamrigCli } from './teamrig-cli'

/** A read takes no lock: far under this, unless the machine is swamped. */
export const READ_TIMEOUT_MS = 30_000

/**
 * The bytes of tasks' JSON one page asks for: half the 4 MiB the engine keeps of a run, so the page's cuts, its
 * envelope and the JSON escapes of control characters fit beside them.
 */
export const TASKS_PAGE_BYTES = 2 * 1024 * 1024

/** Paged reads of `tasks` before the pane gives up on a register that changed between the pages of each one. */
export const PAGED_READ_TRIES = 3

/** One page of `tasks` to ask for: the task it starts after (null: the first page), and its size in bytes. */
export type TasksPageAsk = { readonly after: string | null; readonly maxBytes: number }

/** A document to read, and the revision the caller still holds of it (null: none, so it is read whole). */
export type ReadAsk<Name extends DocumentName = DocumentName> = { readonly name: Name; readonly held: string | null }

/**
 * Who a read asks as. `session` is the area the pane draws (the CLI's `--session`): named whenever it is known, so
 * the tab's own session variable never picks another inbox than the one drawn; with null the CLI finds the asker
 * itself, by that variable and then by the conversation. `conversation` is the host's id of the conversation the
 * pane runs in, which teamrig answers the `sessions` document's `self` by.
 */
export type ReadAsker = { readonly session: string | null; readonly conversation: string }

/**
 * What a read narrows its documents to, each left to teamrig's default when absent: `team`, a team above the
 * caller's (the CLI's `--team`); `owner`, one session's tasks (`--owner`); `range`, the days `stats` counts (`--range`).
 */
export type ReadNarrowing = { readonly team?: string; readonly owner?: string; readonly range?: StatsRange }

export type ReadPorts = {
  /** Runs `argv`, the teamrig CLI and its words (teamrig-cli.ts cliArgv); rejects when it cannot start or outlasts `timeoutMs`. */
  run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>
}

/** A conversation id teamrig's `--conversation` takes; it refuses the whole run for any other. */
const CONVERSATION = /^[A-Za-z0-9_.:-]{1,128}$/

/**
 * What a read answered: the documents it could read with what it could not, as lines to show; or why it read none.
 * Only documents asked for are handed back, so a caller's own names type the map.
 */
export type ReadResult<Name extends DocumentName = DocumentName> =
  | { readonly kind: 'read'; readonly documents: ReadonlyMap<Name, ReadDocument>; readonly problems: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string }

function nothingRead<Name extends DocumentName>(): ReadResult<Name> {
  return { kind: 'read', documents: new Map(), problems: [] }
}

function failed(reason: string): { readonly kind: 'failed'; readonly reason: string } {
  return { kind: 'failed', reason: shownText(reason) }
}

/**
 * The CLI's words naming who asks, which `read` and `events` take alike, so a follower watches the documents a read
 * would build. A conversation id teamrig would refuse the run for is left out, so the run still goes, with no `self`.
 */
export function askerWords(asker: ReadAsker): string[] {
  const words: string[] = []
  if (asker.session !== null) words.push('--session', asker.session)
  if (CONVERSATION.test(asker.conversation)) words.push('--conversation', asker.conversation)
  return words
}

/**
 * The CLI's words for one read of `asks` as `asker`. The revisions held go in one `--unless`, a comma list: teamrig's
 * parser refuses a flag given twice. `narrowing` adds a flag for each of its fields given, and `page` asks for one
 * page of `tasks`.
 */
export function readWords(asks: readonly ReadAsk[], asker: ReadAsker, narrowing: ReadNarrowing = {}, page: TasksPageAsk | null = null): string[] {
  const words = ['read', ...asks.map(ask => ask.name), '--json']
  const held = asks.flatMap(ask => (ask.held === null ? [] : [`${ask.name}=${ask.held}`]))
  if (held.length > 0) words.push('--unless', held.join(','))
  words.push(...askerWords(asker))
  if (narrowing.team !== undefined) words.push('--team', narrowing.team)
  if (narrowing.owner !== undefined) words.push('--owner', narrowing.owner)
  if (narrowing.range !== undefined) words.push('--range', narrowing.range)
  if (page !== null) {
    words.push('--max-bytes', String(page.maxBytes))
    if (page.after !== null) words.push('--after', page.after)
  }
  return words
}

/** What `run` answered to `asks`. */
export function readResult<Name extends DocumentName>(run: CliRun, asks: readonly ReadAsk<Name>[]): ReadResult<Name> {
  if (run.exitCode !== 0) return failed(failureLines(run, 'read').join(' '))
  if (run.isStdoutTruncated) return failed('teamrig read printed more than the pane can take in one run')
  const answer = readAnswer(run.stdout)
  const documents = new Map<Name, ReadDocument>()
  const problems = [...answer.unreadable]
  /** The documents asked for whose problem is already told. */
  const told = new Set<Name>()
  for (const document of answer.documents) {
    const ask = asks.find(each => each.name === document.name)
    if (ask === undefined) continue
    if (document.isUnchanged && ask.held === null) {
      // Unchanged from nothing held leaves nothing to draw: it is told as a problem, never taken as a document.
      problems.push(`teamrig read answered ${document.name} as unchanged to a read that held none of it`)
      told.add(ask.name)
    } else {
      documents.set(ask.name, document)
    }
  }
  if (documents.size === 0) {
    return failed(problems.length > 0 ? problems.join('; ') : 'teamrig read printed no document the pane can read: update teamrig')
  }
  for (const ask of asks) {
    if (!documents.has(ask.name) && !told.has(ask.name)) problems.push(`teamrig read printed no ${ask.name} document`)
  }
  return { kind: 'read', documents, problems }
}

/** Where the CLI is, how to run it, and who asks with what narrowing: what every run of one read shares. */
type ReadContext = {
  readonly main: string
  readonly ports: ReadPorts
  readonly asker: ReadAsker
  readonly narrowing: ReadNarrowing
}

/** One paged read of `tasks`: the joined document, why it read none, or that the register moved between its pages. */
type PagedTasks =
  | { readonly kind: 'read'; readonly document: ReadDocument; readonly problems: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'moved' }

function runRead(context: ReadContext, asks: readonly ReadAsk[], page: TasksPageAsk | null): Promise<CliRun> {
  return context.ports.run(cliArgv(context.main, readWords(asks, context.asker, context.narrowing, page)), READ_TIMEOUT_MS)
}

/** Why a paged read read nothing, after the one run that was cut. */
function pagedFailure(reason: string): { readonly kind: 'failed'; readonly reason: string } {
  return failed(`teamrig read printed more than the pane can take in one run, and reading tasks a page at a time failed: ${reason}`)
}

/**
 * Reads `tasks` page by page once, the first page handing back the revision held. A page of another revision than the
 * first means the register changed between them: the read is `moved`, to start again. A cursor served twice would
 * page forever, so it ends the read as a failure.
 */
async function readTaskPagesOnce<Name extends DocumentName>(context: ReadContext, ask: ReadAsk<Name>): Promise<PagedTasks> {
  const pages: ReadDocument[] = []
  const problems: string[] = []
  const cursors = new Set<string>()
  let after: string | null = null
  do {
    const asked: ReadAsk<Name> = pages.length === 0 ? ask : { name: ask.name, held: null }
    const result = readResult(await runRead(context, [asked], { after, maxBytes: TASKS_PAGE_BYTES }), [asked])
    if (result.kind === 'failed') return pagedFailure(result.reason)
    const page = result.documents.get(ask.name)
    if (page === undefined) return pagedFailure(result.problems.join('; '))
    problems.push(...result.problems)
    if (page.isUnchanged) return { kind: 'read', document: page, problems }
    const [first] = pages
    if (first !== undefined && page.revision !== first.revision) return { kind: 'moved' }
    pages.push(page)
    after = nextOf(page)
    if (after !== null && cursors.has(after)) return pagedFailure(`teamrig served the page after ${after} twice`)
    if (after !== null) cursors.add(after)
  } while (after !== null)
  const [first, ...rest] = pages
  return first === undefined ? pagedFailure('teamrig served no page') : { kind: 'read', document: joinedPages(first, rest), problems }
}

/** Reads `tasks` page by page, again from the first page while the register moves between pages, at most `PAGED_READ_TRIES` times. */
async function readTaskPages<Name extends DocumentName>(context: ReadContext, ask: ReadAsk<Name>): Promise<PagedTasks> {
  for (let attempt = 0; attempt < PAGED_READ_TRIES; attempt += 1) {
    const read = await readTaskPagesOnce(context, ask)
    if (read.kind !== 'moved') return read
  }
  return pagedFailure(`the register changed between its pages ${PAGED_READ_TRIES} times in a row`)
}

/** Reads `asks` after their one run was cut: the documents but `tasks` in one run, `tasks` a page at a time. */
async function readPaged<Name extends DocumentName>(context: ReadContext, asks: readonly ReadAsk<Name>[], tasks: ReadAsk<Name>): Promise<ReadResult<Name>> {
  const others = asks.filter(ask => ask.name !== tasks.name)
  const rest = others.length === 0 ? nothingRead<Name>() : readResult(await runRead(context, others, null), others)
  if (rest.kind === 'failed') return rest
  const paged = await readTaskPages(context, tasks)
  if (paged.kind === 'failed') return paged
  if (paged.kind === 'moved') return pagedFailure('the register kept changing')
  const documents = new Map(rest.documents)
  documents.set(tasks.name, paged.document)
  return { kind: 'read', documents, problems: [...rest.problems, ...paged.problems] }
}

/**
 * Reads `asks` as `asker`, narrowed by `narrowing`, in one run of `cli`, or, when the engine cut a run that asked for
 * `tasks`, with `tasks` read a page at a time; with none to read it runs nothing. A run that cannot finish is a
 * failure, never a throw.
 */
export async function readDocuments<Name extends DocumentName>(
  cli: TeamrigCli,
  ports: ReadPorts,
  asks: readonly ReadAsk<Name>[],
  asker: ReadAsker,
  narrowing: ReadNarrowing = {},
): Promise<ReadResult<Name>> {
  if (asks.length === 0) return nothingRead()
  if (cli.kind === 'missing') return failed(cli.problem)
  const context: ReadContext = { main: cli.main, ports, asker, narrowing }
  try {
    const run = await runRead(context, asks, null)
    const tasks = asks.find(ask => ask.name === 'tasks')
    if (run.exitCode === 0 && run.isStdoutTruncated && tasks !== undefined) return await readPaged(context, asks, tasks)
    return readResult(run, asks)
  } catch (error) {
    return failed(`teamrig read did not finish: ${messageOf(error)}`)
  }
}
