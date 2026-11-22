// The register as the refresher drives it (hooks/register-subject.ts): the documents it draws from, that it is read
// whatever view shows and keeps the tick, that it tells the revisions its source holds, and that the stream is
// followed again once the source asks as another session or conversation than the follower does (T4760).
import { describe, expect, test } from 'claude-code/testing'
import type { ReadAsker } from '../hooks/read-port'
import { FollowedAsker, NO_ASKER, REGISTER_DOCUMENTS, refollowIfMoved, registerSubject, type HeldDocuments } from '../hooks/register-subject'

/** A source holding `revisions` and asking as `asker`, both set by a test. */
class FakeDocuments implements HeldDocuments {
  revisions: Record<string, string> = { tasks: 't1', inbox: 'i1' }
  asker: ReadAsker | null = null

  heldRevision(document: string): string | null {
    return this.revisions[document] ?? null
  }
}

type Rig = { documents: FakeDocuments; asker: FollowedAsker; refollows: () => number; reads: string[] }

function rig(read: () => Promise<boolean> = () => Promise.resolve(true)): Rig & { subject: ReturnType<typeof registerSubject> } {
  const documents = new FakeDocuments()
  const asker = new FollowedAsker(documents)
  let refollows = 0
  const reads: string[] = []
  const subject = registerSubject({
    refresh: () => {
      reads.push('read')
      return read()
    },
    documents,
    asker,
    refollow: () => {
      refollows += 1
      asker.take()
    },
  })
  return { documents, asker, refollows: () => refollows, reads, subject }
}

describe('registerSubject', () => {
  test('draws from the five register documents, keeps the tick and is read whatever view shows', async () => {
    const { subject } = rig()
    expect(subject.documents).toEqual(REGISTER_DOCUMENTS)
    expect(REGISTER_DOCUMENTS).toEqual(['tasks', 'sessions', 'config', 'inbox', 'plan'])
    expect(subject.polls).toBe(true)
    expect(await subject.isShown()).toBe(true)
  })

  test('tells the revision its source holds of each document', () => {
    const { subject } = rig()
    expect([subject.held('tasks'), subject.held('inbox'), subject.held('plan')]).toEqual(['t1', 'i1', null])
  })

  test('answers what the register read answered', async () => {
    expect(await rig(() => Promise.resolve(false)).subject.refresh()).toBe(false)
    expect(await rig().subject.refresh()).toBe(true)
  })

  test('a read after which the source asks as another session follows the stream again, once', async () => {
    const { documents, asker, refollows, subject } = rig()
    expect(asker.take()).toEqual(NO_ASKER)
    documents.asker = { session: 'api', conversation: 'c-1' }
    await subject.refresh()
    expect(refollows()).toBe(1)
    await subject.refresh()
    expect(refollows()).toBe(1)
  })

  test('a new conversation follows the stream again too', async () => {
    const { documents, asker, refollows, subject } = rig()
    documents.asker = { session: 'api', conversation: 'c-1' }
    asker.take()
    documents.asker = { session: 'api', conversation: 'c-2' }
    await subject.refresh()
    expect(refollows()).toBe(1)
  })

  test('before any follower started, a read follows nothing again', async () => {
    const { documents, refollows, subject } = rig()
    documents.asker = { session: 'api', conversation: 'c-1' }
    await subject.refresh()
    expect(refollows()).toBe(0)
  })
})

describe('refollowIfMoved', () => {
  test('follows again only when the source asks as another than the follower', () => {
    const documents = new FakeDocuments()
    const asker = new FollowedAsker(documents)
    let refollows = 0
    const check = (): void => refollowIfMoved({ asker, refollow: () => void (refollows += 1) })
    documents.asker = { session: 'lead', conversation: 'c-1' }
    expect(asker.take()).toEqual({ session: 'lead', conversation: 'c-1' })
    check()
    expect(refollows).toBe(0)
    documents.asker = { session: 'api', conversation: 'c-1' }
    check()
    expect(refollows).toBe(1)
  })
})
