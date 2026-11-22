// The pane's state with its writes told: the app draws again when a press, a reader, the team's front or the wheel
// changed what the screen shows, and no writer has to say that it did. Every writer is handed this one store, so a
// write made outside the app (a team's read, an act's late result) is told as a press is. A write that leaves a key's
// value the one it held (the same value, not an equal one) is not told, so a drawing that writes back what it read
// never asks for another drawing.
import type { PaneKey, PaneStore } from '../hooks/pane-store'
import type { PaneState } from '../types'

/** Told of each key a write gave another value. */
export type ChangeListener = (key: PaneKey) => void

/** A store that tells its listeners of each changing write. */
export interface ObservedStore extends PaneStore {
  /** Tells `listener` of each changing write from now on; the function it answers stops that. */
  onChange(listener: ChangeListener): () => void
}

/** `inner`, telling every listener of each key a write gave another value. */
export class WatchedStore implements ObservedStore {
  readonly #inner: PaneStore
  #listeners: readonly ChangeListener[] = []

  constructor(inner: PaneStore) {
    this.#inner = inner
  }

  read<K extends PaneKey>(key: K): Promise<PaneState[K]> {
    return this.#inner.read(key)
  }

  async update<K extends PaneKey>(key: K, change: (current: PaneState[K]) => PaneState[K]): Promise<PaneState[K]> {
    let isSame = false
    const next = await this.#inner.update(key, current => {
      const made = change(current)
      isSame = Object.is(made, current)
      return made
    })
    if (!isSame) for (const listener of this.#listeners) listener(key)
    return next
  }

  onChange(listener: ChangeListener): () => void {
    this.#listeners = [...this.#listeners, listener]
    return () => {
      this.#listeners = this.#listeners.filter(each => each !== listener)
    }
  }
}
