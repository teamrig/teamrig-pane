// Copied from teamrig's src/config/launch.ts by scripts/sync-core.ts: change it there, then run the sync.
import type { Check } from './reader.ts';
import { EFFORT_LEVELS, isEffortLevel, type KitConfig, type LaunchConfig } from './types.ts';

/** Leaves the model to Claude Code: `launch` passes no `--model` for it. */
export const DEFAULT_MODEL_ALIAS = 'default';

/**
 * The shape of a model name any host could take: an alias or a full id, with a provider or date part and an optional
 * bracketed window suffix such as `[1m]`. Which names a host really runs is its models port's `problemOf`, asked
 * where a name is used (hire, open, doctor), so a team config loads on every host.
 */
export const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@:/-]*(?:\[[a-z0-9]+\])?$/;
export const MODEL_NAME_MAX_LENGTH = 100;

export const isModel: Check<string> = (model) =>
  model.length <= MODEL_NAME_MAX_LENGTH && MODEL_NAME_PATTERN.test(model)
    ? undefined
    : `expected a model name: a letter or digit, then letters, digits or . _ @ : / -, at most ${MODEL_NAME_MAX_LENGTH} characters`;

export const isEffort: Check<string> = (effort) => (isEffortLevel(effort) ? undefined : `expected one of ${EFFORT_LEVELS.join(', ')}`);

/**
 * What the team config itself sets for the session (`launch.<id>`), without the lead's defaults: the restore reopens a
 * session on an effort set here, and on the level it last ran at otherwise (T2440).
 */
export function ownLaunchOf(config: KitConfig, id: string): LaunchConfig {
  // By its own keys only, so an id such as `constructor` never reads the object's prototype.
  return Object.entries(config.launch).find(([key]) => key === id)?.[1] ?? {};
}

/**
 * The model and effort a session starts on: its own `launch` entry, and for the lead `leadDefault` (the host's lead
 * default, src/cli/host.ts `leadLaunchOf`) under each key the entry leaves unset. Other sessions leave unset keys to
 * the host.
 */
export function launchOf(config: KitConfig, id: string, leadDefault: LaunchConfig): LaunchConfig {
  const own = ownLaunchOf(config, id);
  return config.roles.lead === id ? { ...leadDefault, ...own } : own;
}

/** What a launch takes from the host it runs on (src/cli/host.ts `launchHostOf`). */
export interface LaunchHost {
  /** The lead's start under each key its `launch` entry leaves unset, as `launchOf` takes it. */
  readonly leadDefault: LaunchConfig;
  /** Why the host would not run a model name, or undefined when it would; a host that knows no models takes any. */
  readonly modelProblem: Check<string>;
}

/**
 * Why a launch's model will not run on the host, or undefined: a name of the right shape the host refuses, such as
 * another provider's model. The default model is the host's own, so it always runs.
 */
export function launchModelProblem(launch: LaunchConfig, host: Pick<LaunchHost, 'modelProblem'>): string | undefined {
  return isDefaultModel(launch.model) ? undefined : host.modelProblem(launch.model);
}

/** True when the settings leave the model to Claude Code. */
export function isDefaultModel(model: string | undefined): model is typeof DEFAULT_MODEL_ALIAS | undefined {
  return model === undefined || model === DEFAULT_MODEL_ALIAS;
}

/** The settings in words, such as "model best at xhigh effort", for the lines a person reads. */
export function describeLaunch(settings: LaunchConfig): string {
  const { model, effort } = settings;
  if (isDefaultModel(model)) {
    return effort === undefined ? 'the default model and effort' : `the default model at ${effort} effort`;
  }
  return `model ${model} at ${effort ?? 'the default'} effort`;
}
