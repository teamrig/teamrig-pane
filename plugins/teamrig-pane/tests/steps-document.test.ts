// The steps teamrig needs its person to take, from teamrig's `steps` document (hooks/steps-document.ts): each step
// reads field by field in the order served; a step whose command is not `/teamrig steps run <its id>` and flags is
// left out and told, never offered to type; a document with no step list is unreadable (T5015).
import { describe, expect, test } from 'claude-code/testing'
import { parseDocument, type JsonRecord, type ReadDocument } from '../hooks/read-document'
import { isStepCommand, stepsOf, type PendingStep } from '../hooks/steps-document'
import { servedStep, stepsDocument } from './served-documents'

function documentOf(steps: unknown, over: JsonRecord = {}): ReadDocument {
  const read = parseDocument({ ...stepsDocument('s1', [], over), steps })
  if (read.kind !== 'document') throw new Error(`the fixture is no document: ${read.kind}`)
  return read.document
}

function readOf(document: ReadDocument): { steps: readonly PendingStep[]; problems: readonly string[] } {
  const read = stepsOf(document)
  if (read.kind !== 'read') throw new Error(read.reason)
  return { steps: read.value, problems: read.problems }
}

const CONFIG_FORMAT: PendingStep = {
  id: 'config-format',
  title: 'Update your team settings',
  why: 'teamrig reads a newer config format',
  preview: ['version: 3 -> 4', 'moves focus.score'],
  command: '/teamrig steps run config-format --yes',
}

describe('stepsOf', () => {
  test('reads a step field by field', () => {
    const served = { ...CONFIG_FORMAT, preview: [...CONFIG_FORMAT.preview] }
    expect(readOf(documentOf([served]))).toEqual({ steps: [CONFIG_FORMAT], problems: [] })
  })

  test('an empty list means no step is pending', () => {
    expect(readOf(documentOf([]))).toEqual({ steps: [], problems: [] })
  })

  test('keeps the order served, which is the order they are taken', () => {
    const { steps } = readOf(documentOf([servedStep('zeta'), servedStep('alpha')]))
    expect(steps.map(step => step.id)).toEqual(['zeta', 'alpha'])
  })

  test('leaves out a step whose command takes another step, and tells it', () => {
    const { steps, problems } = readOf(documentOf([servedStep('config-format', { command: '/teamrig steps run other --yes' }), servedStep('ok')]))
    expect(steps.map(step => step.id)).toEqual(['ok'])
    expect(problems).toEqual(['teamrig served 1 step the pane cannot read, config-format (command): update teamrig-pane'])
  })

  test('leaves out a step with a field of another type, naming the field', () => {
    const { steps, problems } = readOf(documentOf([servedStep('config-format', { preview: 'one line' })]))
    expect(steps).toEqual([])
    expect(problems).toEqual(['teamrig served 1 step the pane cannot read, config-format (preview): update teamrig-pane'])
  })

  test('an entry that is no record is left out', () => {
    const { problems } = readOf(documentOf(['config-format']))
    expect(problems).toEqual(['teamrig served 1 step the pane cannot read, an entry that is no step: update teamrig-pane'])
  })

  test('a document with no step list is unreadable', () => {
    expect(stepsOf(documentOf(null))).toEqual({ kind: 'unreadable', reason: "teamrig's steps document holds no step list: update teamrig" })
  })
})

describe('isStepCommand', () => {
  test('takes the step by its own id, with flags or none', () => {
    expect(isStepCommand('config-format', '/teamrig steps run config-format --yes')).toBe(true)
    expect(isStepCommand('config-format', '/teamrig steps run config-format')).toBe(true)
    expect(isStepCommand('config-format', '/teamrig steps run config-format --yes --dry-run')).toBe(true)
  })

  test('refuses any other word, a chained command, a flag value or a stray space', () => {
    expect(isStepCommand('config-format', '/teamrig steps run config-format --yes; rm -rf ~')).toBe(false)
    expect(isStepCommand('config-format', '/teamrig steps run config-format && echo')).toBe(false)
    expect(isStepCommand('config-format', '/teamrig steps run config-format --to=x')).toBe(false)
    expect(isStepCommand('config-format', '/teamrig steps run config-format  --yes')).toBe(false)
    expect(isStepCommand('config-format', '/teamrig steps run config-format\n--yes')).toBe(false)
    expect(isStepCommand('config-format', 'teamrig steps run config-format --yes')).toBe(false)
    expect(isStepCommand('config-format', '/teamrig steps config-format --yes')).toBe(false)
  })

  test('refuses an id that is no step kind, even when the command names it', () => {
    expect(isStepCommand('Config Format', '/teamrig steps run Config Format')).toBe(false)
    expect(isStepCommand('', '/teamrig steps run ')).toBe(false)
  })
})
