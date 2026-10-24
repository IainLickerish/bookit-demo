import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const docker = vi.hoisted(() => ({
  calls: [] as string[][],
  handler: undefined as undefined | ((args: string[]) => { code: number; output: string }),
}));

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (_command: string, args: string[]) => {
      docker.calls.push(args);
      const child = Object.assign(new EventEmitter(), {
        stdin: { end() {} },
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(),
      });
      queueMicrotask(() => {
        const result = docker.handler?.(args) ?? { code: -1, output: '' };
        child.stdout.emit('data', Buffer.from(result.output));
        child.emit('close', result.code);
      });
      return child;
    },
  };
});

import { prepareComposeTenant } from '../helpers/compose';

beforeEach(() => {
  docker.calls.length = 0;
});

describe('a3eg REQ-18.1-03 REQ-18.1-06 REQ-18.2-01 scoped Compose cleanup', () => {
  it('removes its captured project resources, retains volumes/evidence and leaves a foreign project untouched', async () => {
    const clinic = await prepareComposeTenant('acme');
    const own = clinic.project;
    const networks = new Set([`${own}_clinic`, `${own}_ingress`, 'foreign_clinic']);
    const volumes = new Set([`${own}_database`, `${own}_logs`, 'foreign_database']);
    const evidence = '{"retained":"original evidence"}\n';
    writeFileSync(path.join(clinic.directory, 'evidence.json'), evidence);
    docker.handler = (args) => {
      if (args[0] === 'compose') {
        expect(args[args.indexOf('-p') + 1]).toBe(own);
        expect(args).not.toContain('--volumes');
        expect(args).not.toContain('-v');
        expect(args).not.toContain('--rmi');
        for (const name of [...networks]) if (name.startsWith(`${own}_`)) networks.delete(name);
        return { code: 0, output: 'removed project resources' };
      }
      expect(args).toContain(`label=com.docker.compose.project=${own}`);
      return {
        code: 0,
        output: [...(args[0] === 'network' ? networks : volumes)]
          .filter((name) => name.startsWith(`${own}_`))
          .join('\n'),
      };
    };
    // Public metadata cannot redirect the captured command closure to a different project.
    clinic.project = 'foreign';
    await clinic.stop();
    expect([...networks]).toEqual(['foreign_clinic']);
    expect([...volumes]).toEqual([`${own}_database`, `${own}_logs`, 'foreign_database']);
    expect(readFileSync(path.join(clinic.directory, 'evidence.json'), 'utf8')).toBe(evidence);
    const record = JSON.parse(readFileSync(path.join(clinic.directory, 'cleanup.json'), 'utf8')) as {
      checks: Record<string, boolean>;
      project: string;
    };
    expect(record.project).toBe(own);
    expect(Object.values(record.checks).every(Boolean)).toBe(true);
  });

  it('reports a failed down command without publishing Docker diagnostic values', async () => {
    const clinic = await prepareComposeTenant('beacon');
    const canary = clinic.canaries[0]!;
    docker.handler = (args) => (args[0] === 'compose' ? { code: 17, output: canary } : { code: 0, output: '' });
    await expect(clinic.stop()).rejects.toThrow('Compose project cleanup failed');
    const source = readFileSync(path.join(clinic.directory, 'cleanup.json'), 'utf8');
    expect(source.includes(canary)).toBe(false);
    expect((JSON.parse(source) as { downExit: number }).downExit).toBe(17);
  });

  it('attempts down even when inventory fails, and refuses a false cleanup success', async () => {
    const clinic = await prepareComposeTenant('acme');
    docker.handler = (args) => (args[0] === 'compose' ? { code: 0, output: '' } : { code: 1, output: '' });
    await expect(clinic.stop()).rejects.toThrow('Compose project cleanup failed');
    expect(docker.calls.filter((args) => args[0] === 'compose')).toHaveLength(1);
  });
});
