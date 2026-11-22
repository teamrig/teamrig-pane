// The dock's carrier of teamrig's event stream (T4760): a ChangeFeed over the engine's `$.process.spawn`, running
// `teamrig events --json` for the documents followed and reading its stdout's pieces as frames (change-feed.ts). The
// engine ties the child to the loop reading it: leaving the loop, `return()` on the stream or the module unloading
// kills it, so `stop` returns the stream and a reloaded pane leaves no follower behind. teamrig's follower also ends
// itself once its starter is gone. A stream that never said hello and exited non-zero is a teamrig that cannot follow
// here (one older than `events`, or a refusal): that is `unavailable`, told with what it wrote to stderr, so the
// refresher polls instead of restarting it; one that said hello and then ended is `ended`, and is followed again.
// Runs the teamrig CLI only; no model calls.
import { askerWords, type ReadAsker } from './read-port'
import { shownText } from './shown-text'
import { cliArgv, linesOf, type TeamrigCli } from './teamrig-cli'
import { frameReader, type ChangeFeed, type FeedEnd, type FeedHandle, type FeedListener } from './change-feed'
import { messageOf } from './errors'

export type SpawnChunk = { readonly stream: 'stdout' | 'stderr'; readonly text: string }
export type SpawnEnd = { readonly code: number | null; readonly signal: string | null }
/**
 * A child's output as `$.process.spawn` streams it: the pieces, then how it ended. Only the two calls the feed makes:
 * the engine's async generator is one, and a test's fake needs no generator to patch.
 */
export type SpawnStream = {
  next: () => Promise<IteratorResult<SpawnChunk, SpawnEnd>>
  return: (value: SpawnEnd) => Promise<IteratorResult<SpawnChunk, SpawnEnd>>
}

export type SpawnFeedPorts = {
  /** Starts `argv` with no shell, as `$.process.spawn`; the first pull rejects when it cannot start. */
  readonly spawn: (request: { readonly argv: readonly string[] }) => SpawnStream
  /** Where the teamrig CLI is; asked at each follow, so a CLI installed later is found. */
  readonly cli: () => Promise<TeamrigCli>
  /** Who the pane asks as: the follower watches the documents a read as the same asker builds. */
  readonly asker: () => ReadAsker
}

/** Enough of stderr to say why a follower could not start; a refusal is one line. */
export const STDERR_KEPT_CHARS = 2_000

/** What `return()` hands the stream: the loop is left, and the engine kills the child. */
const STOPPED: SpawnEnd = { code: null, signal: null }

/** The CLI's words following `documents` as `asker`. */
export function eventsWords(documents: readonly string[], asker: ReadAsker): string[] {
  return ['events', '--json', '--documents', documents.join(','), ...askerWords(asker)]
}

/** Why a follower that never said hello ended: its stderr, else its exit. */
function startProblem(stderr: string, end: SpawnEnd): string {
  const said = linesOf(stderr).join(' ')
  if (said !== '') return shownText(`teamrig events: ${said}`)
  return end.code === null ? `teamrig events ended by ${end.signal ?? 'a signal'}` : `teamrig events exited ${end.code}`
}

export function spawnFeed(ports: SpawnFeedPorts): ChangeFeed {
  return {
    follow: (documents: readonly string[], listener: FeedListener): FeedHandle => {
      let isStopped = false
      let stream: SpawnStream | null = null
      let hasSaidHello = false
      const end = (how: FeedEnd): void => {
        if (!isStopped) listener.onEnd(how)
        isStopped = true
      }
      const read = frameReader({
        onFrame: frame => {
          if (frame.event === 'hello') hasSaidHello = true
          if (!isStopped) listener.onFrame(frame)
        },
        onProblem: reason => {
          if (!isStopped) listener.onProblem(reason)
        },
      })
      void (async () => {
        let cli: TeamrigCli
        try {
          cli = await ports.cli()
        } catch (error) {
          listener.onProblem(shownText(`cannot find the teamrig CLI: ${messageOf(error)}`))
          return end('unavailable')
        }
        if (isStopped) return
        if (cli.kind === 'missing') return end('unavailable')
        const child = ports.spawn({ argv: cliArgv(cli.main, eventsWords(documents, ports.asker())) })
        stream = child
        let hasPulled = false
        let stderr = ''
        try {
          for (;;) {
            const step = await child.next()
            hasPulled = true
            if (isStopped) return
            if (step.done === true) {
              if (!hasSaidHello && step.value.code !== 0) {
                listener.onProblem(startProblem(stderr, step.value))
                return end('unavailable')
              }
              return end('ended')
            }
            const { stream: pipe, text } = step.value
            if (pipe === 'stderr') {
              if (stderr.length < STDERR_KEPT_CHARS) stderr = (stderr + text).slice(0, STDERR_KEPT_CHARS)
              continue
            }
            read(text)
          }
        } catch (error) {
          if (isStopped) return
          if (!hasPulled) listener.onProblem(shownText(`teamrig events could not start: ${messageOf(error)}`))
          return end(hasPulled ? 'ended' : 'unavailable')
        }
      })()
      return {
        stop: () => {
          if (isStopped) return
          isStopped = true
          stream?.return(STOPPED).catch(() => undefined)
        },
      }
    },
  }
}
