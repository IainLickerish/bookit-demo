import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export const ROOT = path.resolve(import.meta.dirname, '../..');

export interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string | boolean;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

export interface Job {
  name?: string;
  if?: string;
  needs?: string | string[];
  'runs-on': string;
  environment?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}

export interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}

/** A child process's whole environment; nothing is inherited, so tests never see this host's variables. */
export type ChildEnv = Record<string, string>;

/** `spawnSync` types `env` as ProcessEnv, which Next.js augments with a required NODE_ENV. */
export function processEnv(env: ChildEnv): NodeJS.ProcessEnv {
  return env as NodeJS.ProcessEnv;
}

/** The parsed workflow file and its raw text. */
export function loadWorkflow(name: string): { workflow: Workflow; text: string } {
  const text = readFileSync(path.join(ROOT, '.github/workflows', name), 'utf8');
  return { workflow: parse(text) as Workflow, text };
}

/** The step with this id; fails the test when it is missing. */
export function stepById(job: Job, id: string): Step {
  const step = job.steps.find((candidate) => candidate.id === id);
  if (!step?.run) throw new Error(`Step ${id} with a run script is missing`);
  return step;
}
