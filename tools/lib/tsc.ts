import { createRequire } from 'node:module';

/**
 * TypeScript's compiler, run by this Node (npm cannot be spawned without a shell on Windows). Found as Node finds a
 * package, from this file up, so a worktree with no node_modules of its own runs its main checkout's, as npm does.
 */
export const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');
