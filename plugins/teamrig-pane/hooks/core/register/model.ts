// Copied from teamrig's src/register/model.ts by scripts/sync-core.ts: change it there, then run the sync.
import { isNonNegativeInteger } from '../core/guards.ts';
import { ID_PATTERN } from '../core/ids.ts';

/**
 * Task states. The first four are active: the task still needs its owner. `verifying` is a change that has
 * shipped and waits for what proves it (a test run, a night's flow, a number), named by its `--proof`; it may also
 * carry what that proof waits for, typed (waits.ts). `waiting` cannot go on until each of its typed reasons clears.
 */
export const TASK_STATUSES = ['open', 'in-progress', 'verifying', 'waiting', 'done', 'dropped'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ACTIVE_STATUSES: readonly TaskStatus[] = ['open', 'in-progress', 'verifying', 'waiting'];

/** The statuses a change may name the task's follow-ups with (`set --followups`): shipping, finishing or dropping it. */
export const FOLLOWUP_STATUSES: readonly TaskStatus[] = ['verifying', 'done', 'dropped'];

/** The statuses a bug's review may be asked at (`register.review.requireOn`): never dropped, whose note says why. */
export const REVIEW_STATUSES: readonly TaskStatus[] = ['verifying', 'done'];

/**
 * The statuses that carry typed wait reasons (waits.ts): `waiting` needs at least one; `verifying` may name what its
 * proof waits for (the task asked of whoever runs the proof, the time it comes, the owner's approval), so the party
 * that holds the proof has it on its own list and the owner is not asked to verify what it cannot yet.
 */
export const WAIT_STATUSES: readonly TaskStatus[] = ['waiting', 'verifying'];

/**
 * The status `waiting` replaced in teamrig 0.10.0. A line that names it reads as `waiting` with no reasons and is
 * never rewritten; the CLI and the config refuse it, naming `waiting`.
 */
export const LEGACY_WAITING_STATUS = 'blocked';

/** What a refusal of the old status starts with. */
export const LEGACY_WAITING_HINT = `${LEGACY_WAITING_STATUS} was replaced by waiting`;

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.some((status) => status === value);
}

/** Session and area names: the shared id rule, as they name inbox files and folders. */
export const SESSION_NAME = ID_PATTERN;

/**
 * The source of a task imported from a GitHub issue: only `teamrig issue sync` writes one (sync/sync.ts),
 * and a session cannot give it to a task (policy.ts). Kept here, with the register's other names, so the
 * read side (views.ts, and the pane's copy of it) needs no write policy.
 */
export const GITHUB_SOURCE = 'github';

/** What every issue ref starts with; here, beside GITHUB_SOURCE, so the write policy can tell an issue ref apart. */
export const ISSUE_REF_PREFIX = 'gh:';

/** An issue ref as its type: the prefix, then what issues/ref.ts reads (`parseRef`). */
export type IssueRefText = `${typeof ISSUE_REF_PREFIX}${string}`;

/**
 * Whether a ref points at an issue or pull request, by its prefix alone. The one test of the prefix: here, since the
 * write policy asks it and this folder cannot import src/issues, which imports it.
 */
export function isIssueRef(ref: string | null | undefined): ref is IssueRefText {
  return typeof ref === 'string' && ref.startsWith(ISSUE_REF_PREFIX);
}

/**
 * The trackers `teamrig issue sync` imports from, each source beside the prefix its tasks' refs start with. A task
 * of one of these sources was written by the import alone (policy.ts). The source is the connector's id and the
 * prefix its declaration's `refPrefix`: this folder imports no adapter, so the composition spec holds the two equal.
 * The local connector is no import source: its `local: ` refs carry a reason, not an issue.
 */
export const IMPORT_SOURCES = { [GITHUB_SOURCE]: ISSUE_REF_PREFIX, jira: 'jira:' } as const;

/** A tracker the import writes tasks for, by its connector id. */
export type ImportSource = keyof typeof IMPORT_SOURCES;

/** A ref an import source wrote: its prefix, then an id only that tracker's connector reads. */
export type TrackerRefText = `${(typeof IMPORT_SOURCES)[ImportSource]}${string}`;

/** Every import source, in the table's order; model.test.ts holds it equal to the table's keys. */
export const IMPORT_SOURCE_IDS: readonly ImportSource[] = [GITHUB_SOURCE, 'jira'];

export function isImportSource(value: unknown): value is ImportSource {
  return IMPORT_SOURCE_IDS.some((source) => source === value);
}

/**
 * Whether a ref points at an issue of any import source, by its prefix alone. Never a generic `<word>:` test: the
 * register holds free-text refs (`https:...`) beside the trackers' own.
 */
export function isTrackerRef(ref: string | null | undefined): ref is TrackerRefText {
  return typeof ref === 'string' && IMPORT_SOURCE_IDS.some((source) => ref.startsWith(IMPORT_SOURCES[source]));
}

/**
 * The ref of a task kept off GitHub: this, then the reason (`add --local`), so the reason is on the task and never
 * posted. Here, beside ISSUE_REF_PREFIX, so the check can tell a task with its reason from one with neither.
 */
export const LOCAL_REF_PREFIX = 'local: ';

/** Whether a task's ref points at its issue or says why it has none: the two refs `github.issueAtAdd` accepts. */
export function hasIssueOrReason(ref: string | null): boolean {
  return isIssueRef(ref) || (ref !== null && ref.startsWith(LOCAL_REF_PREFIX));
}

/**
 * The blocker level (T4329), above p0: drop everything and fix it now. Lower is more urgent, so every sort and every
 * `<= p0` test already puts it first. On disk it is `priority: 0` with `blocker: true` (events.ts), so an older teamrig,
 * which refuses a negative priority, reads it as p0.
 */
export const BLOCKER_PRIORITY_ID = -1;

/** Whether a stored value is a priority id: the blocker's, or p0 and below. */
export function isPriorityId(value: unknown): value is number {
  return value === BLOCKER_PRIORITY_ID || isNonNegativeInteger(value);
}

/** How the blocker level is typed and printed. */
export const BLOCKER_PRIORITY_TEXT = 'blocker';

/** A priority as the CLI prints and takes it: `blocker`, then `p0`, `p1` and so on, most urgent first. */
export function priorityText(priority: number): string {
  return priority === BLOCKER_PRIORITY_ID ? BLOCKER_PRIORITY_TEXT : `p${priority}`;
}

/**
 * How a work class is spelled (`Roadmap`, `Tech debt`; T2076): a letter, then up to 31 letters, digits, spaces, `_` or
 * `-`. Kept here so the register's parse and the config's `focus.classes` share it.
 */
export const WORK_CLASS_NAME = /^[A-Za-z][A-Za-z0-9 _-]{0,31}$/;

/** Whether a priority is at the top: `p1`, or a `p0` or blocker above it, so an urgent task never falls out of a top count. */
export function isTopPriority(priority: number): boolean {
  return priority <= 1;
}

/** Task ids are `T` and a positive integer, allocated in order by the register. */
export const TASK_ID = /^T[1-9]\d*$/;
