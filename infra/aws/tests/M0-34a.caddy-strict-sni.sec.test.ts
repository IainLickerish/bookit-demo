import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repository, run, runFolder, writeEvidence, type Observation } from './support';

// F-21: BookIt's front door enables strict SNI and Host matching. The production Caddyfile runs in the pinned Caddy
// image with local certificates for .test names, offline except for the loopback ports it publishes.
const testId = 'M0-34a.caddy-strict-sni';
const ids = ['F-21', 'REQ-18.1-06', 'DR-009', 'HC-01', 'HC-07'];
const observations: Observation[] = [];
const folder = runFolder(testId);
const caddyfile = path.join(repository, 'infra/caddy/Caddyfile');
const image = /image: (caddy:\S+)/.exec(
  readFileSync(path.join(repository, 'infra/aws/host/edge.compose.yml'), 'utf8'),
)![1]!;
const suffix = randomUUID().slice(0, 8);
const names = { acmeNet: `m034a-acme-${suffix}`, beaconNet: `m034a-beacon-${suffix}`, edge: `m034a-edge-${suffix}` };
const hosts = { acme: 'acme.bookit.test', beacon: 'beacon.bookit.test' };
const started: string[] = [];
let httpsPort = '';
let httpPort = '';

function record(assertion: string, expected: unknown, observed: unknown): void {
  observations.push({ assertion, expected, observed, pass: JSON.stringify(expected) === JSON.stringify(observed) });
  expect(observed, assertion).toEqual(expected);
}

function docker(...args: string[]) {
  const result = run('docker', args);
  if (result.code !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function curl(args: string[]) {
  const result = run('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', ...args]);
  return { exit: result.code, status: result.stdout.trim() };
}
const https = (sni: string, host: string) =>
  curl(['--resolve', `${sni}:${httpsPort}:127.0.0.1`, '-H', `Host: ${host}`, `https://${sni}:${httpsPort}/`]);
const http = (host: string) => curl(['-H', `Host: ${host}`, `http://127.0.0.1:${httpPort}/`]);

beforeAll(() => {
  // Test copy: identical sites and server options, plus local certificates instead of a public ACME CA.
  const source = readFileSync(caddyfile, 'utf8');
  const testFile = path.join(folder, 'Caddyfile');
  const testSource = source.replace(/^\{$/m, '{\n\tlocal_certs\n\tskip_install_trust');
  if (testSource === source) throw new Error('Caddyfile has no global options block');
  writeFileSync(testFile, testSource);
  docker('network', 'create', names.acmeNet);
  docker('network', 'create', names.beaconNet);
  for (const [product, network] of [
    ['acme', names.acmeNet],
    ['beacon', names.beaconNet],
  ] as const) {
    const name = `m034a-${product}-app-${suffix}`;
    docker(
      'run',
      '-d',
      '--name',
      name,
      '--network',
      network,
      '--network-alias',
      `${product}-app`,
      image,
      'caddy',
      'respond',
      '--listen',
      ':3000',
      '--body',
      product,
    );
    started.push(name);
  }
  docker(
    'run',
    '-d',
    '--name',
    names.edge,
    '--network',
    names.acmeNet,
    '-p',
    '127.0.0.1::443',
    '-p',
    '127.0.0.1::80',
    '-e',
    `ACME_HOST=${hosts.acme}`,
    '-e',
    `BEACON_HOST=${hosts.beacon}`,
    '-v',
    `${testFile}:/etc/caddy/Caddyfile:ro`,
    image,
  );
  started.push(names.edge);
  docker('network', 'connect', names.beaconNet, names.edge);
  httpsPort = docker('port', names.edge, '443/tcp').split(':').pop()!;
  httpPort = docker('port', names.edge, '80/tcp').split(':').pop()!;
  for (let attempt = 0; attempt < 60 && https(hosts.acme, hosts.acme).status !== '200'; attempt += 1) {
    run('sleep', ['0.5']);
  }
});

describe('M0-34a F-21 HC-01 HC-07 strict SNI and Host matching on the BookIt front door', () => {
  it('enables strict_sni_host on every server of the production Caddyfile', () => {
    const adapted = run('docker', [
      'run',
      '--rm',
      '--network',
      'none',
      '-e',
      `ACME_HOST=${hosts.acme}`,
      '-e',
      `BEACON_HOST=${hosts.beacon}`,
      '-v',
      `${caddyfile}:/etc/caddy/Caddyfile:ro`,
      image,
      'caddy',
      'adapt',
      '--config',
      '/etc/caddy/Caddyfile',
    ]);
    const servers = Object.values(JSON.parse(adapted.stdout).apps.http.servers) as { strict_sni_host?: boolean }[];
    record(
      'servers with strict_sni_host',
      servers.map(() => true),
      servers.map((s) => s.strict_sni_host === true),
    );
  });

  it('serves each product on its own name', () => {
    record('acme SNI and Host', '200', https(hosts.acme, hosts.acme).status);
    record('beacon SNI and Host', '200', https(hosts.beacon, hosts.beacon).status);
  });

  it('answers 421 when the Host header names the other product', () => {
    record('acme SNI with beacon Host', '421', https(hosts.acme, hosts.beacon).status);
    record('beacon SNI with acme Host', '421', https(hosts.beacon, hosts.acme).status);
  });

  it('fails the TLS handshake for an unknown name', () => {
    const result = https('other.bookit.test', 'other.bookit.test');
    record('unknown SNI handshake fails', true, result.exit !== 0 && result.status === '000');
  });

  it('redirects known names to HTTPS and aborts unknown names on plain HTTP', () => {
    record('acme HTTP redirect', '308', http(hosts.acme).status);
    const unknown = http('other.bookit.test');
    record('unknown HTTP host aborted', true, unknown.exit !== 0 && unknown.status === '000');
  });
});

afterAll(() => {
  for (const name of started) run('docker', ['rm', '-f', name]);
  run('docker', ['network', 'rm', names.acmeNet, names.beaconNet]);
  writeEvidence(folder, testId, ids, observations);
});
