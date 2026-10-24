import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const repository = path.resolve(import.meta.dirname, '../../..');
export const moduleDir = path.join(repository, 'infra/aws');

export interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function run(command: string, args: readonly string[], cwd = repository): Result {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export interface Observation {
  readonly assertion: string;
  readonly expected: unknown;
  readonly observed: unknown;
  readonly pass: boolean;
}

/** A fresh retained folder for one run: test-results/<testId>/<uuid>/ (ignored by git). */
export function runFolder(testId: string): string {
  const folder = path.join(repository, 'test-results', testId, randomUUID());
  mkdirSync(folder, { recursive: true });
  return folder;
}

export function writeEvidence(folder: string, testId: string, ids: readonly string[], observations: Observation[]) {
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const evidence = { testId, ids, head, observations, pass: observations.every((o) => o.pass) };
  writeFileSync(path.join(folder, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
}
