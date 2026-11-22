// One document as a reader of `teamrig read` holds it between runs: the value last read, the revision handed back
// so teamrig answers `unchanged`, and the lines to show of what could not be served. Pure.
import type { BodyRead } from './document-fields'
import type { ReadDocument } from './read-document'

/** One document as the source holds it between reads. */
export class Held<T> {
  /** The last value read; null until one is. */
  value: T | null = null
  /** The revision of `value`, handed back so teamrig answers `unchanged` for it; null with none held. */
  revision: string | null = null
  /** What teamrig and the reader could not serve of `value`. */
  private problems: readonly string[] = []
  /** Why the newest answer could not be read; null when it was, or said nothing changed. */
  trouble: string | null = null
  private readonly reader: (document: ReadDocument) => BodyRead<T>

  constructor(reader: (document: ReadDocument) => BodyRead<T>) {
    this.reader = reader
  }

  /**
   * Takes a run's answer. One that cannot be read keeps the value last drawn and its revision, so the next run reads
   * the document whole again and the reason stays until it can be read.
   */
  take(document: ReadDocument): void {
    if (document.isUnchanged) {
      this.trouble = null
      return
    }
    const read = this.reader(document)
    if (read.kind === 'unreadable') {
      this.trouble = read.reason
      return
    }
    this.value = read.value
    this.revision = document.revision
    this.problems = [...document.problems, ...read.problems]
    this.trouble = null
  }

  /** The lines to show for this document. */
  get lines(): readonly string[] {
    return this.trouble === null ? this.problems : [...this.problems, this.trouble]
  }
}
