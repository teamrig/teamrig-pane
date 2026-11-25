// The pages of one paged `tasks` read (T5464, interface 1.10) joined into the one document a whole read would have
// printed. A register past the 4 MiB the engine keeps of a run is read a page at a time (read-port.ts); every page of
// one read carries the same revision, so the pages are joined in the order read, their tasks and cuts one after the
// other, and the document's other fields from the first page. `next` is the cursor a page names the next one by, so
// the joined document names none: it is whole. Parses and joins only; runs nothing.
import type { JsonRecord, ReadDocument } from './read-document'

/** The id of the task the page after `page` starts after; null on the last page, and from a teamrig that pages nothing. */
export function nextOf(page: ReadDocument): string | null {
  const next = page.fields['next']
  return typeof next === 'string' && next !== '' ? next : null
}

function listOf(fields: JsonRecord, key: string): readonly unknown[] {
  const value = fields[key]
  return Array.isArray(value) ? value : []
}

/**
 * The one document `pages` make, read in order: the first page's envelope and fields, every page's tasks and cuts in
 * turn, and each problem once.
 */
export function joinedPages(first: ReadDocument, rest: readonly ReadDocument[]): ReadDocument {
  const pages = [first, ...rest]
  return {
    ...first,
    problems: [...new Set(pages.flatMap(page => page.problems))],
    fields: {
      ...first.fields,
      tasks: pages.flatMap(page => listOf(page.fields, 'tasks')),
      cuts: pages.flatMap(page => listOf(page.fields, 'cuts')),
      next: null,
    },
  }
}
