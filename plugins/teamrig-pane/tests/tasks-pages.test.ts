// The pages of one paged tasks read (hooks/tasks-pages.ts): joined in the order read, every page's tasks and cuts in
// turn, the other fields from the first page, each problem once, and no cursor left on the whole document (T5464).
import { describe, expect, test } from 'claude-code/testing'
import type { ReadDocument } from '../hooks/read-document'
import { joinedPages, nextOf } from '../hooks/tasks-pages'

function page(fields: Readonly<Record<string, unknown>>, problems: readonly string[] = []): ReadDocument {
  return {
    name: 'tasks',
    interface: { major: 1, minor: 10 },
    revision: 'r8',
    isUnchanged: false,
    problems,
    fields: { interface: '1.10', document: 'tasks', revision: 'r8', ...fields },
  }
}

describe('nextOf', () => {
  test('names the task the next page starts after', () => {
    expect(nextOf(page({ next: 'T12' }))).toBe('T12')
  })

  test('is null on the last page, from a teamrig that pages nothing, and for a cursor that is no id', () => {
    expect(nextOf(page({ next: null }))).toBeNull()
    expect(nextOf(page({}))).toBeNull()
    expect(nextOf(page({ next: '' }))).toBeNull()
    expect(nextOf(page({ next: 12 }))).toBeNull()
  })
})

describe('joinedPages', () => {
  test("joins every page's tasks and cuts in order, the other fields from the first page", () => {
    const first = page({ tasks: [{ id: 'T1' }], cuts: [{ field: 'T1.note' }], retired: 4, next: 'T1' })
    const second = page({ tasks: [{ id: 'T2' }, { id: 'T3' }], cuts: [], retired: 4, next: 'T3' })
    const last = page({ tasks: [{ id: 'T4' }], cuts: [{ field: 'T4.title' }], retired: 4, next: null })
    expect(joinedPages(first, [second, last]).fields).toEqual({
      interface: '1.10',
      document: 'tasks',
      revision: 'r8',
      tasks: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }, { id: 'T4' }],
      cuts: [{ field: 'T1.note' }, { field: 'T4.title' }],
      retired: 4,
      next: null,
    })
  })

  test('tells each problem once, and keeps the envelope of the first page', () => {
    const joined = joinedPages(page({ tasks: [] }, ['2 damaged lines left out']), [page({ tasks: [] }, ['2 damaged lines left out', 'other'])])
    expect(joined.problems).toEqual(['2 damaged lines left out', 'other'])
    expect(joined.revision).toBe('r8')
    expect(joined.interface).toEqual({ major: 1, minor: 10 })
  })

  test('one page is the whole document, its cursor cleared', () => {
    expect(joinedPages(page({ tasks: [{ id: 'T1' }], next: null }), []).fields['tasks']).toEqual([{ id: 'T1' }])
  })

  test('a page with no list of tasks or cuts adds none', () => {
    expect(joinedPages(page({ tasks: 'none' }), [page({ tasks: [{ id: 'T2' }] })]).fields).toMatchObject({ tasks: [{ id: 'T2' }], cuts: [] })
  })
})
