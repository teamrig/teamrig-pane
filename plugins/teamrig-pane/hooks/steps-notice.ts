// The steps notice (T5015): a one-time step teamrig needs its person to take (steps-document.ts), drawn in the band
// above the prompt (register.tsx) over the banner, so a person who updated teamrig sees it in any tab, the pane open or
// not. Only the first pending step is drawn, the one to take now: its title after a dim `step to take`, a dim line of
// why, what it changes a line each, and a dim count of the steps after it. A button beside its title types the step's
// command into the person's own prompt box as a draft ($.prompt.fill, replace mode): nothing is sent. The command
// takes the step at once (teamrig serves it with --yes), so their own Enter, under the lines of what it changes, is
// their consent. Pure: the block that layout.ts wraps and register.tsx draws, and the toast line a fill ends in.
import { SEPARATOR, type Block, type Row, type Span } from './rows'
import type { PendingStep } from './steps-document'

/** The block's key, and its head row's. */
export const STEPS_KEY = 'steps'
/** The key and label of the button that types the step's command into the prompt box. */
export const STEP_FILL_KEY = 'steps-fill'
export const STEP_FILL_LABEL = 'type it in'

const STEP_TO_TAKE: Span = { text: 'step to take', dim: true }

/** The step the notice offers: the first pending, which teamrig serves first because it is taken first; null for none. */
export function stepShown(steps: readonly PendingStep[]): PendingStep | null {
  return steps[0] ?? null
}

/** The notice's block for `step`, the first of `count` pending: its title, why, what it changes and how many come after it. */
export function stepsBlock(step: PendingStep, count: number): Block {
  const under = (key: string, spans: Span[]): Row => ({ key: `${STEPS_KEY}:${key}`, spans })
  const after = count - 1
  return {
    key: STEPS_KEY,
    rows: [
      { key: STEPS_KEY, spans: [STEP_TO_TAKE, SEPARATOR, { text: step.title, bold: true }] },
      under('why', [{ text: step.why, dim: true }]),
      ...step.preview.map((line, i) => under(`preview:${i}`, [{ text: `  ${line}` }])),
      ...(after > 0 ? [under('after', [{ text: after === 1 ? '1 more step after it' : `${after} more steps after it`, dim: true }])] : []),
    ],
  }
}

/**
 * A fill of the prompt box, and its answer, as $.prompt.fill takes and gives them: the pane's own shapes, since only
 * the dock's files import the engine (tools/ci/engine-boundary.ts), and the engine's types fit them.
 */
export type StepFill = { readonly text: string; readonly mode: 'replace' }
export type StepFilled = { readonly isFilled: boolean; readonly refusal?: 'no_composer' | 'dialog' | 'unanswered' }

/**
 * What the button asks $.prompt.fill for: `step`'s command over the prompt box's draft. register.tsx makes the call
 * itself, since the engine allows `$.prompt` only spelled out at its call site.
 */
export function fillArgs(step: PendingStep): StepFill {
  return { text: step.command, mode: 'replace' }
}

/**
 * How the fill of `step`'s command went, in a line for a toast: that it waits in the prompt box for their Enter, or
 * why the box did not take it and what to type in its place.
 */
export function filledLine(step: PendingStep, filled: StepFilled): string {
  if (filled.isFilled) return `${step.command} is in your prompt: press Enter to take the step`
  switch (filled.refusal) {
    case 'no_composer':
      return `this tab has no prompt box: type ${step.command} in a session's tab`
    case 'dialog':
      return 'a dialog holds the keys: close it, then press the button again'
    case 'unanswered':
      return `the prompt box did not answer: check whether it holds ${step.command}`
  }
  // A hook's refusal names no reason.
  return `a plugin kept the step out of your prompt: type ${step.command} yourself`
}
