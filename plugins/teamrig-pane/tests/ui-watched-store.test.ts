// The store that tells of its writes: each key given another value, to every listener, never one written back as it
// was, and no more once a listener stops.
import { describe, expect, test } from 'claude-code/testing'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore, type PaneKey } from '../hooks/pane-store'
import { WatchedStore } from '../ui/watched-store'

function told(): { readonly keys: PaneKey[]; readonly inner: MemoryStore; readonly store: WatchedStore; readonly stop: () => void } {
  const keys: PaneKey[] = []
  const inner = new MemoryStore(INITIAL_STATE)
  const store = new WatchedStore(inner)
  const stop = store.onChange(key => keys.push(key))
  return { keys, inner, store, stop }
}

describe('a store that tells of its writes', () => {
  test('a write that changes a key is written through, answered and told', async () => {
    const { keys, inner, store } = told()
    expect(await store.update('banner', () => true)).toBe(true)
    expect(inner.state.banner).toBe(true)
    expect(keys).toEqual(['banner'])
  })

  test('a write that gives back the value held is not told', async () => {
    const { keys, store } = told()
    expect(await store.update('nav', current => current)).toBe(INITIAL_STATE.nav)
    expect(keys).toEqual([])
  })

  test('each changing write is told, in order', async () => {
    const { keys, store } = told()
    await store.update('banner', () => true)
    await store.update('previousOpen', () => true)
    await store.update('banner', current => current)
    await store.update('banner', () => false)
    expect(keys).toEqual(['banner', 'previousOpen', 'banner'])
  })

  test('reads what the store holds', async () => {
    const { store } = told()
    await store.update('banner', () => true)
    expect(await store.read('banner')).toBe(true)
  })

  test('tells every listener, and a stopped one no more', async () => {
    const { keys, store, stop } = told()
    const others: PaneKey[] = []
    store.onChange(key => others.push(key))
    await store.update('banner', () => true)
    stop()
    await store.update('previousOpen', () => true)
    expect(keys).toEqual(['banner'])
    expect(others).toEqual(['banner', 'previousOpen'])
  })
})
