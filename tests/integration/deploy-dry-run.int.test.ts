import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadWorkflow, processEnv, ROOT, type ChildEnv, type Step } from '../helpers/workflows';

// The deploy dry-run harness (M0-34b, F-41, F-38). It runs the deploy workflow's own `check` steps, exactly as written
// in deploy.yml, with GitHub's bash options and fake `gh` and `docker` commands, and prints each refusal reason.

const REPOSITORY = 'IainLickerish/bookit-demo';
const HEAD = 'a'.repeat(40);
const ON_MAIN = 'b'.repeat(40);
const DIGEST = `sha256:${'c'.repeat(64)}`;
const EVIDENCE_DIR = path.join(ROOT, 'test-results/M0-34b');

const FAKE_GH = `#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_LOG"
case "$1 $2" in
  "api repos/${REPOSITORY}/compare/"*)
    if [ "$FAKE_COMPARE" = missing ]; then echo '{"message":"Not Found"}' >&2; exit 1; fi
    echo "$FAKE_COMPARE" ;;
  "attestation verify")
    [ "$FAKE_ATTESTATION" = valid ] || { echo "no attestation matched the policy" >&2; exit 1; } ;;
  *) echo "unexpected gh call" >&2; exit 2 ;;
esac
`;

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
if [ "$1 $2 $3" = "buildx imagetools inspect" ]; then
  [ "$FAKE_IMAGE" = published ] || { echo "not found" >&2; exit 1; }
  echo '{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"${DIGEST}","size":1}'
  exit 0
fi
echo "unexpected docker call" >&2
exit 2
`;

interface Case {
  name: string;
  ref?: string;
  product?: string;
  products?: string;
  sha?: string;
  compare?: string;
  image?: string;
  attestation?: string;
  expected: { refusedAt: string | null; reason: RegExp };
}

interface Outcome {
  name: string;
  expected: { refusedAt: string | null; reason: string };
  observed: { refusedAt: string | null; reason: string; ran: string[] };
  calls: string[];
}

const fakeBin = mkdtempSync(path.join(tmpdir(), 'bookit-deploy-harness-'));
writeFileSync(path.join(fakeBin, 'gh'), FAKE_GH);
writeFileSync(path.join(fakeBin, 'docker'), FAKE_DOCKER);
chmodSync(path.join(fakeBin, 'gh'), 0o755);
chmodSync(path.join(fakeBin, 'docker'), 0o755);

const { workflow } = loadWorkflow('deploy.yml');
const check = workflow.jobs.check!;
const outcomes: Outcome[] = [];

function resolve(value: string, context: Record<string, string>): string {
  return value.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => {
    const resolved = context[expression];
    if (resolved === undefined) throw new Error(`The harness cannot resolve \${{ ${expression} }}`);
    return resolved;
  });
}

/** Runs the check job's steps in order with dry_run true, stopping at the first failing step as GitHub does. */
function runCheck(testCase: Case): Outcome['observed'] & { calls: string[]; stdout: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'bookit-deploy-case-'));
  const log = path.join(directory, 'calls.log');
  writeFileSync(log, '');
  const context: Record<string, string> = {
    'github.event.repository.default_branch': 'main',
    'inputs.product': testCase.product ?? 'acme',
    'inputs.environment': 'staging',
    'inputs.sha': testCase.sha ?? ON_MAIN,
    'vars.BOOKIT_PRODUCTS': testCase.products ?? 'acme beacon',
    // The fake gh never reads GH_TOKEN, so no token-shaped value exists in the harness.
    'github.token': '',
  };
  const workflowEnv = Object.fromEntries(
    Object.entries(workflow.env ?? {}).map(([key, value]) => [key, resolve(value, context)]),
  );
  const ran: string[] = [];
  let stdout = '';
  for (const step of check.steps as Step[]) {
    if (step.if !== undefined) expect(step.if).toBe('inputs.dry_run');
    const output = path.join(directory, `${step.id ?? 'summary'}.output`);
    writeFileSync(output, '');
    const script = path.join(directory, `${step.id ?? 'summary'}.sh`);
    writeFileSync(script, step.run ?? '');
    const env: ChildEnv = {
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      HOME: directory,
      GITHUB_REF: testCase.ref ?? 'refs/heads/main',
      GITHUB_SHA: HEAD,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: path.join(directory, 'summary.md'),
      FAKE_LOG: log,
      FAKE_COMPARE: testCase.compare ?? 'behind',
      FAKE_IMAGE: testCase.image ?? 'published',
      FAKE_ATTESTATION: testCase.attestation ?? 'valid',
      ...workflowEnv,
      ...Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, resolve(value, context)])),
    };
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      env: processEnv(env),
      encoding: 'utf8',
    });
    ran.push(step.id ?? step.name ?? 'step');
    stdout += result.stdout;
    for (const line of readFileSync(output, 'utf8').split('\n')) {
      const [key, ...value] = line.split('=');
      if (key && step.id) context[`steps.${step.id}.outputs.${key}`] = value.join('=');
    }
    if (result.status !== 0) {
      const reason = (result.stdout + result.stderr).split('\n').find((line) => line.startsWith('::error::')) ?? '';
      return { refusedAt: step.id ?? null, reason: reason.replace('::error::', ''), ran, stdout, calls: lines(log) };
    }
  }
  return { refusedAt: null, reason: stdout.trim().split('\n').at(-1) ?? '', ran, stdout, calls: lines(log) };
}

function lines(file: string): string[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

const cases: Case[] = [
  {
    name: 'refuses a run from a branch other than the default branch',
    ref: 'refs/heads/sa/inc-42',
    expected: {
      refusedAt: 'ref',
      reason: /^Refused: deploy runs only from the default branch main, not refs\/heads\/sa\/inc-42/,
    },
  },
  {
    name: 'refuses a product not listed in BOOKIT_PRODUCTS',
    products: 'acme',
    product: 'beacon',
    expected: {
      refusedAt: 'product',
      reason: /^Refused: product beacon is not listed in repository variable BOOKIT_PRODUCTS/,
    },
  },
  {
    name: 'refuses every product when BOOKIT_PRODUCTS is unset',
    products: '',
    expected: { refusedAt: 'product', reason: /^Refused: product acme is not listed/ },
  },
  {
    name: 'refuses a malformed SHA before calling GitHub',
    sha: 'main',
    expected: { refusedAt: 'sha', reason: /^Refused: sha must be a full 40-character/ },
  },
  {
    name: 'refuses a SHA on another branch (diverged from the default branch head)',
    sha: 'd'.repeat(40),
    compare: 'diverged',
    expected: {
      refusedAt: 'sha',
      reason: /^Refused: commit d{40} is not reachable from the default branch head a{40} \(compare status: diverged\)/,
    },
  },
  {
    name: 'refuses a SHA ahead of the default branch head (an unmerged pull request)',
    sha: 'e'.repeat(40),
    compare: 'ahead',
    expected: { refusedAt: 'sha', reason: /compare status: ahead/ },
  },
  {
    name: 'refuses a SHA GitHub cannot find',
    sha: 'f'.repeat(40),
    compare: 'missing',
    expected: { refusedAt: 'sha', reason: /^Refused: commit f{40} could not be compared/ },
  },
  {
    name: 'refuses a SHA with no published image',
    image: 'missing',
    expected: {
      refusedAt: 'digest',
      reason: /^Refused: no published image ghcr\.io\/iainlickerish\/bookit-demo:b{40}/,
    },
  },
  {
    name: 'refuses an image without a matching build attestation',
    attestation: 'invalid',
    expected: {
      refusedAt: 'attestation',
      reason: /^Refused: ghcr\.io\/iainlickerish\/bookit-demo@sha256:c{64} has no build attestation/,
    },
  },
  {
    name: 'passes a listed product and an attested SHA on the default branch, deploying nothing',
    expected: {
      refusedAt: null,
      reason:
        /^Dry run passed: would deploy ghcr\.io\/iainlickerish\/bookit-demo@sha256:c{64} to acme staging\. Nothing was deployed\.$/,
    },
  },
];

afterAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, 'deploy-dry-run.json'),
    `${JSON.stringify({ test: 'M0-34b deploy dry-run harness', workflow: '.github/workflows/deploy.yml', ids: ['F-41', 'F-38', 'HC-02', 'REQ-18.3-02'], cases: outcomes }, null, 2)}\n`,
  );
});

describe('M0-34b F-41 F-38 HC-02 deploy dry-run harness', () => {
  it.each(cases)('$name', (testCase) => {
    const observed = runCheck(testCase);
    console.log(
      `[deploy dry run] ${testCase.name}: ${observed.refusedAt ? `refused at ${observed.refusedAt}` : 'passed'}: ${observed.reason}`,
    );
    outcomes.push({
      name: testCase.name,
      expected: { refusedAt: testCase.expected.refusedAt, reason: testCase.expected.reason.source },
      observed: { refusedAt: observed.refusedAt, reason: observed.reason, ran: observed.ran },
      calls: observed.calls,
    });
    expect(observed.refusedAt).toBe(testCase.expected.refusedAt);
    expect(observed.reason).toMatch(testCase.expected.reason);
    if (testCase.expected.refusedAt === 'ref' || testCase.expected.refusedAt === 'product') {
      expect(observed.calls).toEqual([]);
    }
    if (testCase.expected.refusedAt === null) {
      expect(observed.calls).toEqual([
        `gh api repos/${REPOSITORY}/compare/${HEAD}...${ON_MAIN} --jq .status`,
        `docker buildx imagetools inspect ghcr.io/iainlickerish/bookit-demo:${ON_MAIN} --format {{json .Manifest}}`,
        `gh attestation verify oci://ghcr.io/iainlickerish/bookit-demo@${DIGEST} --repo ${REPOSITORY} --signer-workflow ${REPOSITORY}/.github/workflows/ci.yml --source-ref refs/heads/main --source-digest ${ON_MAIN} --deny-self-hosted-runners`,
      ]);
    }
  });

  it('accepts the default branch head itself (compare status identical)', () => {
    const observed = runCheck({
      name: 'identical',
      sha: HEAD,
      compare: 'identical',
      expected: { refusedAt: null, reason: /./ },
    });
    expect(observed.refusedAt).toBeNull();
    expect(observed.stdout).toContain(`Commit ${HEAD} is reachable from the default branch head ${HEAD}.`);
  });
});
