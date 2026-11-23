// Copied from teamrig's src/sync/scope.ts by scripts/sync-core.ts: change it there, then run the sync.
import type { HostIssue } from '../issues/issue.ts';
import type { SyncPlan, SyncStep } from './plan.ts';

/** How an issue's assignees bring it into scope: `team`, one of the team's people; `none`, never (labels only). */
export const ASSIGNED_SCOPES = ['team', 'none'] as const;

export type AssignedScope = (typeof ASSIGNED_SCOPES)[number];

export function isAssignedScope(value: unknown): value is AssignedScope {
  return ASSIGNED_SCOPES.some((scope) => scope === value);
}

/**
 * Which issues of a place (a repository, a project) the import reads, the same model for every tracker: every open
 * one (`all`), else those assigned to one of the team's people or carrying one of `labels`. A connector turns it into
 * its own search query so a large place is never read whole; the core checks each issue again (scopeIssues), so
 * a connector that gives more than asked cannot flood the register.
 */
export interface ImportScope {
  /** Every open issue of the place, the import's reach before scopes; off by default. */
  readonly all: boolean;
  /** `team` takes an issue assigned to one of the team's people; `none` takes labels only. */
  readonly assigned: AssignedScope;
  /** An issue carrying one of these (matched without case) is in scope, whoever it is assigned to. */
  readonly labels: readonly string[];
}

/** The scope a team gets with no setup: its people's issues and those labelled `teamrig`. */
export const DEFAULT_SCOPE: ImportScope = { all: false, assigned: 'team', labels: ['teamrig'] };

/**
 * One place's scope as a list reads it: the scope, the team's people as the tracker names them (logins or
 * account ids), and the issue numbers the register already imports from the place. A held issue is always listed,
 * so narrowing the scope never freezes a task: its close still arrives.
 */
export interface ScopeRequest {
  readonly scope: ImportScope;
  readonly people: readonly string[];
  readonly held: readonly number[];
}

/** The caps on what one tracker's import adds: the open tasks it holds at most, and the most one run adds. */
export interface ScopeCaps {
  readonly maxOpen: number;
  readonly maxNewPerSync: number;
}

/** The caps a team gets with no setup. */
export const DEFAULT_CAPS: ScopeCaps = { maxOpen: 200, maxNewPerSync: 50 };

function lower(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

/** Whether `issue` is in `request`'s scope: a held one always is. */
export function inScope(issue: HostIssue, request: ScopeRequest): boolean {
  if (request.scope.all || request.held.includes(issue.number)) {
    return true;
  }
  const labels = lower(request.scope.labels);
  if (issue.labels.some((label) => labels.has(label.toLowerCase()))) {
    return true;
  }
  if (request.scope.assigned === 'none') {
    return false;
  }
  const people = lower(request.people);
  return issue.assignees.some((login) => people.has(login.toLowerCase()));
}

/** A list cut to its scope: the issues kept, and how many the tracker gave outside it. */
export interface ScopedIssues {
  readonly issues: readonly HostIssue[];
  readonly outside: number;
}

/** The issues of `issues` in `request`'s scope (inScope), the tracker's order kept. */
export function scopeIssues(issues: readonly HostIssue[], request: ScopeRequest): ScopedIssues {
  const kept = issues.filter((issue) => inScope(issue, request));
  return { issues: kept, outside: issues.length - kept.length };
}

/** The ref the register holds an issue under (ImportTracker.refOf of its place and number), undefined when it has none. */
export type IssueRefOf = (issue: HostIssue) => string | undefined;

/** A plan cut to the caps: the plan whose adds fit, and how many adds the caps held back with the key that held the first. */
export interface CappedPlan {
  readonly plan: SyncPlan;
  readonly held: number;
  readonly key: 'maxOpen' | 'maxNewPerSync' | undefined;
}

/**
 * `plan` with its adds cut to `caps`, given the `open` tasks the import already holds: at most `maxNewPerSync` adds,
 * and none past `maxOpen` open tasks. Updates and status changes of held tasks are never cut. The adds kept are the
 * first by `order` (issues assigned to the team's people first, then the one changed longest ago), so a rerun keeps
 * the same ones and the next run takes the next.
 */
export function capPlan(plan: SyncPlan, issues: readonly HostIssue[], refOf: IssueRefOf, request: ScopeRequest, caps: ScopeCaps, open: number): CappedPlan {
  const adds = plan.steps.filter((step) => step.kind === 'add');
  const room = Math.max(0, caps.maxOpen - open);
  const allowed = Math.min(caps.maxNewPerSync, room);
  if (adds.length <= allowed) {
    return { plan, held: 0, key: undefined };
  }
  const rank = addOrder(issues, refOf, request);
  const kept = new Set([...adds].sort((a, b) => rank(a) - rank(b)).slice(0, allowed));
  const steps: SyncStep[] = plan.steps.filter((step) => step.kind !== 'add' || kept.has(step));
  const held = adds.length - allowed;
  return {
    plan: { ...plan, steps, inserted: plan.inserted - held },
    held,
    key: room < caps.maxNewPerSync ? 'maxOpen' : 'maxNewPerSync',
  };
}

/** The rank of an add step: its issue's place in the order capPlan keeps adds by. */
function addOrder(issues: readonly HostIssue[], refOf: IssueRefOf, request: ScopeRequest): (step: SyncStep) => number {
  const people = lower(request.people);
  const ordered = [...issues].sort((a, b) => {
    const assigned = Number(isAssigned(b, people)) - Number(isAssigned(a, people));
    return assigned !== 0 ? assigned : changedAt(a) - changedAt(b) || a.number - b.number;
  });
  const byRef = new Map<string, number>();
  ordered.forEach((issue, index) => {
    const ref = refOf(issue);
    if (ref !== undefined && !byRef.has(ref)) {
      byRef.set(ref, index);
    }
  });
  return (step) => byRef.get(step.ref) ?? ordered.length;
}

function isAssigned(issue: HostIssue, people: ReadonlySet<string>): boolean {
  return issue.assignees.some((login) => people.has(login.toLowerCase()));
}

function changedAt(issue: HostIssue): number {
  const at = issue.updatedAt === undefined ? Number.NaN : Date.parse(issue.updatedAt);
  return Number.isNaN(at) ? Number.MAX_SAFE_INTEGER : at;
}
