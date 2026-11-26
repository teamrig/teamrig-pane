// The one-time steps teamrig needs its person to take, from teamrig's `steps` document (interface 1.9, T5015): each
// step's id, its title and why in plain words, what it changes a line each, and the command the person types to take
// it, in the order teamrig serves them, which is the order they are taken. An empty list means none is pending. The
// pane offers to type a step's command into the person's own prompt box, so the command is the one field it hands
// on rather than only draws: it is kept only as `/teamrig steps run <the step's own id>` followed by `--flag` words,
// and a step whose command says anything else is left out and told in the problem line, never offered. An
// `unchanged` answer holds no list, so it is never handed here. Pure.
import { BY_ID, Fields, isList, leftOutLine, listOf, type BodyRead } from './document-fields'
import type { ReadDocument } from './read-document'

/** One step teamrig needs its person to take. */
export type PendingStep = {
  /** The step's kind, such as `config-format`: what `teamrig steps run` takes. */
  readonly id: string
  readonly title: string
  readonly why: string
  /** What the step changes, a line each. */
  readonly preview: readonly string[]
  /** What the person types in a tab to take the step. */
  readonly command: string
}

/** A step's kind as teamrig names one: lower-case words joined by hyphens. */
const STEP_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
/** A flag `teamrig steps run` may be typed with. */
const FLAG = /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Whether `command` takes the step `id` names and nothing else: the words `teamrig steps run` takes it by, then only flags. */
export function isStepCommand(id: string, command: string): boolean {
  if (!STEP_ID.test(id)) return false
  const [slash, verb, run, named, ...flags] = command.split(' ')
  return slash === '/teamrig' && verb === 'steps' && run === 'run' && named === id && flags.every(flag => FLAG.test(flag))
}

function stepOf(entry: Fields): PendingStep {
  return { id: entry.text('id'), title: entry.text('title'), why: entry.text('why'), preview: entry.texts('preview'), command: entry.text('command') }
}

function unreadable(why: string): BodyRead<readonly PendingStep[]> {
  return { kind: 'unreadable', reason: `teamrig's steps document ${why}: update teamrig` }
}

/**
 * The steps `document` lists, in its order, with the ones left out told in one line; unreadable without a step list,
 * which every `steps` document of this major holds.
 */
export function stepsOf(document: ReadDocument): BodyRead<readonly PendingStep[]> {
  const served = document.fields['steps']
  if (!isList(served)) return unreadable('holds no step list')
  const { values, left } = listOf(served, 'step', stepOf, BY_ID)
  const steps: PendingStep[] = []
  for (const step of values) {
    if (isStepCommand(step.id, step.command)) steps.push(step)
    else left.push(`${step.id} (command)`)
  }
  return { kind: 'read', value: steps, problems: left.length === 0 ? [] : [leftOutLine('step', left)] }
}
