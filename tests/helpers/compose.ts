import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { loadTenant, type TenantName } from '@/server/seed/tenant';
import { TEST_COMMIT } from './built-server';
import { tenantEvidenceDirectory } from './tenant-evidence';

export const COMPOSE_CLOCK = '2026-10-20T07:00:00.000Z';
export const COMPOSE_IMAGE = 'bookit-m0-24d:test';
export const PRODUCTION_IMAGE = 'bookit-m0-24d:production-test';

export async function runDocker(args: string[], env: NodeJS.ProcessEnv = process.env, timeout = 300_000) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn('docker', args, { env });
    child.stdin.end();
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeout);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

export async function buildComposeImage(allowClock: boolean, commit = TEST_COMMIT) {
  return runDocker(
    [
      'build',
      '--build-arg',
      `GIT_COMMIT=${commit}`,
      '--build-arg',
      `BOOKIT_ALLOW_TEST_CLOCK=${allowClock}`,
      '--build-arg',
      'BUILD_ID=m0-24d-tests',
      '--build-arg',
      `BOOKIT_IMAGE=${allowClock ? COMPOSE_IMAGE : PRODUCTION_IMAGE}`,
      '--build-arg',
      'BUILT_AT=2026-10-23T17:00:00.000Z',
      '-t',
      allowClock ? COMPOSE_IMAGE : PRODUCTION_IMAGE,
      '.',
    ],
    process.env,
    600_000,
  );
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

export async function prepareComposeTenant(name: TenantName) {
  const tenant = loadTenant(name);
  const directory = tenantEvidenceDirectory(`compose-${name}`);
  const privateDir = path.join(directory, 'private');
  mkdirSync(privateDir, { mode: 0o700 });
  const password = randomBytes(24).toString('base64url');
  const bootstrapPassword = randomBytes(24).toString('base64url');
  const accounts = Object.fromEntries(
    tenant.accounts.map((account) => [account.email, randomBytes(24).toString('base64url')]),
  );
  writeFileSync(path.join(privateDir, 'database-password'), password, { mode: 0o444 });
  writeFileSync(path.join(privateDir, 'postgres-password'), bootstrapPassword, { mode: 0o444 });
  writeFileSync(path.join(privateDir, 'accounts.json'), JSON.stringify(accounts), { mode: 0o444 });
  const clockFile = path.join(directory, 'clock.json');
  writeFileSync(clockFile, JSON.stringify({ now: COMPOSE_CLOCK }));
  const port = await freePort();
  const mailPort = await freePort();
  const receiverPort = await freePort();
  const project = `bookit24d-${name}-${randomBytes(4).toString('hex')}`;
  const overrideFile = path.join(directory, 'compose.override.json');
  writeFileSync(
    overrideFile,
    JSON.stringify({
      services: {
        bookit: {
          environment: { BOOKIT_TEST_CLOCK: '/clock/now.json', BOOKIT_SENTRY_DSN: 'http://testkey@fake-sentry:8080/1' },
          volumes: [`${clockFile}:/clock/now.json:ro`],
        },
        seed: { environment: { BOOKIT_TEST_CLOCK: '/clock/now.json' }, volumes: [`${clockFile}:/clock/now.json:ro`] },
        'fake-sentry': {
          image: 'node:24.22.1-bookworm-slim',
          command: ['node', '/receiver.mjs'],
          volumes: [`${path.resolve('tests/helpers/compose-receiver.mjs')}:/receiver.mjs:ro`],
          networks: ['clinic', 'ingress'],
          ports: [`127.0.0.1:${receiverPort}:8080`],
        },
      },
    }),
  );
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DOCKER_HOST: process.env.DOCKER_HOST,
    GIT_COMMIT: TEST_COMMIT,
    BOOKIT_ENV: 'staging',
    BOOKIT_TENANT: name,
    BOOKIT_PUBLIC_URL: `http://127.0.0.1:${port}`,
    BOOKIT_PRODUCT: tenant.product,
    BOOKIT_MAIL_FROM: tenant.mailFrom,
    BOOKIT_CREDENTIALS_DIR: privateDir,
    BOOKIT_PORT: String(port),
    BOOKIT_MAIL_PORT: String(mailPort),
    BOOKIT_LOCAL_IMAGE: COMPOSE_IMAGE,
    BOOKIT_ALLOW_TEST_CLOCK: 'true',
    BOOKIT_DEPLOYMENT_ID: `m0-24d-${name}`,
  };
  const prefix = ['compose', '-p', project, '-f', path.resolve('compose.yml'), '-f', overrideFile];
  const command = (args: string[], timeout?: number) => runDocker([...prefix, ...args], env, timeout);
  return {
    tenant,
    directory,
    privateDir,
    accounts,
    clockFile,
    project,
    env,
    command,
    url: `http://127.0.0.1:${port}`,
    receiverUrl: `http://127.0.0.1:${receiverPort}`,
    canaries: [
      password,
      bootstrapPassword,
      ...Object.values(accounts),
      ...tenant.accounts.flatMap((account) => [account.email, account.name]),
    ],
    async start() {
      return command(['up', '--no-build', '-d', '--wait', '--wait-timeout', '180'], 240_000);
    },
    async stop() {
      // Owner authorization (supportagents-a3eg, comment 36): remove only this test-created project's
      // containers/networks. Named database/log volumes and the already captured host evidence stay intact.
      const inventory = async (kind: 'network' | 'volume') => {
        const result = await runDocker(
          [kind, 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Name}}'],
          env,
          30_000,
        ).catch(() => ({ code: -1, output: '' }));
        return {
          code: result.code,
          names: result.code === 0 ? result.output.trim().split('\n').filter(Boolean).sort() : [],
        };
      };
      const evidenceFile = path.join(directory, 'evidence.json');
      const evidenceHash = () => {
        try {
          return existsSync(evidenceFile)
            ? createHash('sha256').update(readFileSync(evidenceFile)).digest('hex')
            : null;
        } catch {
          return undefined;
        }
      };
      const beforeEvidence = evidenceHash();
      const [networksBefore, volumesBefore] = await Promise.all([inventory('network'), inventory('volume')]);
      const down = await command(['down', '--remove-orphans', '--timeout', '20'], 120_000).catch(() => ({
        code: -1,
        output: '',
      }));
      const [networksAfter, volumesAfter] = await Promise.all([inventory('network'), inventory('volume')]);
      const afterEvidence = evidenceHash();
      const checks = {
        downSucceeded: down.code === 0,
        inventorySucceeded: [networksBefore, volumesBefore, networksAfter, volumesAfter].every(
          (item) => item.code === 0,
        ),
        projectNetworksRemoved: networksAfter.names.length === 0,
        volumesRetained: volumesBefore.names.every((name) => volumesAfter.names.includes(name)),
        evidenceRetained:
          beforeEvidence !== undefined && afterEvidence !== undefined && beforeEvidence === afterEvidence,
      };
      // Do not retain Docker diagnostic text: it is untrusted and can contain environment details.
      writeFileSync(
        path.join(directory, 'cleanup.json'),
        `${JSON.stringify(
          {
            contract: 'a3eg.compose-cleanup.v1',
            project,
            command: ['docker', ...prefix, 'down', '--remove-orphans', '--timeout', '20'],
            downExit: down.code,
            networksBefore,
            networksAfter,
            volumesBefore,
            volumesAfter,
            evidenceSha256: beforeEvidence,
            checks,
          },
          null,
          2,
        )}\n`,
      );
      if (!Object.values(checks).every(Boolean))
        throw new Error(`Compose project cleanup failed; see ${directory}/cleanup.json`);
      return down;
    },
  };
}

export type ComposeTenant = Awaited<ReturnType<typeof prepareComposeTenant>>;
