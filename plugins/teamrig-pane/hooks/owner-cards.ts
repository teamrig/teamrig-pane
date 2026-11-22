// When an owner's card put off (Later) comes back, in teamrig's words. teamrig serves each session's cards on the owner
// in its plan document (interface 1.5), soonest back first; the pane titles them (document-source.ts, titledCards) and
// tells each card's stored time with this.
import { showStored, type TimeZone } from './core/read/index'
import { storedDayWords } from './meta'

/** A stored bare day (`2026-11-02`); a stored minute (`2026-11-02 12:00`) is UTC, and Date.parse would read it as local. */
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/

/** When a Later card comes back, as stored: `Mon 11-02` for a bare day, else teamrig's minute (`11-02 12:00 IDT`). */
export function laterWords(until: string, zone: TimeZone): string {
  return (BARE_DAY.test(until) ? storedDayWords(until) : null) ?? showStored(until, zone)
}
