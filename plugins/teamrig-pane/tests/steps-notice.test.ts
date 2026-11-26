// The steps notice in the band above the prompt (hooks/steps-notice.ts): which step it offers, the rows it draws for
// it, and what a press on its button types into the prompt box and says, filled or refused (T5015).
import { describe, expect, test } from 'claude-code/testing'
import type { PendingStep } from '../hooks/steps-document'
import { fillArgs, filledLine, stepShown, stepsBlock, STEPS_KEY, type StepFilled } from '../hooks/steps-notice'

function step(id: string, over: Partial<PendingStep> = {}): PendingStep {
  return { id, title: `Title of ${id}`, why: `Why ${id} is needed`, preview: [`${id} changes this`], command: `/teamrig steps run ${id} --yes`, ...over }
}

function texts(rows: ReturnType<typeof stepsBlock>['rows']): string[] {
  return rows.map(row => row.spans.map(span => span.text).join(''))
}

describe('stepShown', () => {
  test('is the first step served, the one taken first, and none with none pending', () => {
    expect(stepShown([step('config-format'), step('hooks-move')])?.id).toBe('config-format')
    expect(stepShown([])).toBeNull()
  })
})

describe('stepsBlock', () => {
  test('draws the title after its label, the why, each line it changes, and no count with one step', () => {
    const block = stepsBlock(step('config-format', { preview: ['team.json moves to team.yaml', 'a backup is kept'] }), 1)
    expect(block.key).toBe(STEPS_KEY)
    expect(texts(block.rows)).toEqual(['step to take · Title of config-format', 'Why config-format is needed', '  team.json moves to team.yaml', '  a backup is kept'])
    expect(block.rows[0]?.spans.at(-1)).toEqual({ text: 'Title of config-format', bold: true })
    expect(block.rows[1]?.spans[0]?.dim).toBe(true)
  })

  test('counts the steps after it, one and more', () => {
    expect(texts(stepsBlock(step('a'), 2).rows).at(-1)).toBe('1 more step after it')
    expect(texts(stepsBlock(step('a', { preview: [] }), 3).rows)).toEqual(['step to take · Title of a', 'Why a is needed', '2 more steps after it'])
  })

  test('keys every row apart under the block', () => {
    const keys = stepsBlock(step('a', { preview: ['x', 'y'] }), 2).rows.map(row => row.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('fillArgs', () => {
  test("asks for the command over the prompt's draft, a fill that sends nothing", () => {
    expect(fillArgs(step('config-format'))).toEqual({ text: '/teamrig steps run config-format --yes', mode: 'replace' })
  })
})

describe('filledLine', () => {
  test('says the command waits in the prompt and Enter takes it', () => {
    expect(filledLine(step('config-format'), { isFilled: true })).toBe('/teamrig steps run config-format --yes is in your prompt: press Enter to take the step')
  })

  test('says why the box did not take it, for each refusal the engine gives and for a hook that gives none', () => {
    const answers: StepFilled[] = [{ isFilled: false, refusal: 'no_composer' }, { isFilled: false, refusal: 'dialog' }, { isFilled: false, refusal: 'unanswered' }, { isFilled: false }]
    const lines = answers.map(answer => filledLine(step('a'), answer))
    expect(lines).toEqual([
      "this tab has no prompt box: type /teamrig steps run a --yes in a session's tab",
      'a dialog holds the keys: close it, then press the button again',
      'the prompt box did not answer: check whether it holds /teamrig steps run a --yes',
      'a plugin kept the step out of your prompt: type /teamrig steps run a --yes yourself',
    ])
  })
})
