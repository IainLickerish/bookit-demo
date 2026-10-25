import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadWorkflow, ROOT, type Job } from '../helpers/workflows';

const DEFAULT_BRANCH_PUSH =
  "github.event_name == 'push' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)";
const WRITE_SCOPES = ['packages', 'id-token', 'attestations', 'contents', 'actions', 'deployments', 'pull-requests'];

const ci = loadWorkflow('ci.yml');
const deploy = loadWorkflow('deploy.yml');

function writes(job: Job): string[] {
  return Object.entries(job.permissions ?? {})
    .filter(([scope, level]) => level === 'write' && WRITE_SCOPES.includes(scope))
    .map(([scope]) => scope);
}

function checksOut(job: Job): boolean {
  return job.steps.some((step) => step.uses?.startsWith('actions/checkout@') ?? false);
}

describe('M0-34b workflow lint (actionlint)', () => {
  it('actionlint 1.7.12 reports no findings for ci.yml and deploy.yml', () => {
    const binary = process.env.ACTIONLINT ?? 'actionlint';
    const version = spawnSync(binary, ['-version'], { encoding: 'utf8' });
    expect(version.error, `actionlint is required: set ACTIONLINT or put it on PATH (${binary})`).toBeUndefined();
    const result = spawnSync(binary, ['-color=false'], { cwd: ROOT, encoding: 'utf8' });
    console.log(`actionlint ${version.stdout.split('\n')[0]}: exit ${result.status}\n${result.stdout}${result.stderr}`);
    expect(result.status).toBe(0);
  });

  it('pins every action to a full commit SHA', () => {
    for (const { text } of [ci, deploy]) {
      const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1] ?? '');
      expect(uses.length).toBeGreaterThan(0);
      for (const reference of uses) expect(reference).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });
});

describe('M0-34b F-01 F-38 ci.yml: only default-branch pushes publish images', () => {
  const { workflow, text } = ci;

  it('ignores sa/** pushes and never uses pull_request_target', () => {
    expect(workflow.on.push).toEqual({ 'branches-ignore': ['sa/**'] });
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push']);
    expect(text).not.toContain('pull_request_target');
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('gives package write permission to publish alone, which runs only on default-branch pushes and checks out nothing', () => {
    const writers = Object.entries(workflow.jobs).filter(([, job]) => writes(job).length > 0);
    console.log(
      `jobs with write permission: ${writers.map(([name, job]) => `${name} (${writes(job).join(', ')})`).join('; ')}`,
    );
    expect(writers.map(([name]) => name)).toEqual(['publish']);
    const publish = workflow.jobs.publish!;
    expect(publish.if?.replace(/\s+/g, ' ').trim()).toBe(
      "${{ !cancelled() && needs.test.result == 'success' && needs.image.result == 'success' && " +
        DEFAULT_BRANCH_PUSH +
        ' }}',
    );
    expect(checksOut(publish)).toBe(false);
    expect(writes(publish).sort()).toEqual(['attestations', 'id-token', 'packages']);
    expect(publish.needs).toEqual(['test', 'image']);
  });

  it('runs every other job read-only on GitHub-hosted runners without secrets', () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job['runs-on'], name).toMatch(/^ubuntu-\d/);
      if (name === 'publish') continue;
      expect(writes(job), name).toEqual([]);
      expect(job.permissions?.['id-token'], name).toBeUndefined();
      for (const step of job.steps) {
        if (step.uses?.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials'], name).toBe(false);
      }
    }
    expect(text).not.toMatch(/secrets\./);
  });

  it('holds agent pull requests until the secret-free agent-ci environment is approved', () => {
    const gate = workflow.jobs['agent-approval']!;
    expect(gate.environment).toBe('agent-ci');
    expect(gate.permissions).toEqual({});
    expect(gate.if).toContain("startsWith(github.head_ref, 'sa/')");
    expect(gate.if).toContain("github.event.pull_request.user.type == 'Bot'");
    for (const name of ['test', 'image']) {
      const job = workflow.jobs[name]!;
      expect(job.needs).toBe('agent-approval');
      expect(job.if).toContain("needs.agent-approval.result == 'success' || needs.agent-approval.result == 'skipped'");
    }
  });

  it('fails the image job unless /api/version reports exactly the built commit (F-38)', () => {
    const run = workflow.jobs.image!.steps.find((step) => step.name === 'Run the image and check /api/version')?.run;
    expect(run).toContain('reported="$(jq -r .commit <<< "$version")"');
    expect(run).toContain('if [ "$reported" != "$COMMIT" ]; then');
    const steps = workflow.jobs.publish!.steps.map((step) => step.uses ?? step.name);
    expect(steps.at(-1)).toMatch(/^actions\/attest-build-provenance@/);
    expect(workflow.jobs.publish!.steps.at(-1)?.with?.['push-to-registry']).toBe(true);
  });
});

describe('M0-34b F-41 HC-02 deploy.yml: manual, default branch only, by digest, no checkout', () => {
  const { workflow, text } = deploy;

  it('starts only by manual dispatch with product, environment, sha and dry_run', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    const inputs = (workflow.on.workflow_dispatch as { inputs: Record<string, { options?: string[] }> }).inputs;
    expect(Object.keys(inputs)).toEqual(['product', 'environment', 'sha', 'dry_run']);
    expect(inputs.product?.options).toEqual(['acme', 'beacon']);
    expect(inputs.environment?.options).toEqual(['staging', 'production']);
    expect(workflow.permissions).toEqual({});
  });

  it('checks out and runs no repository code, and interpolates no expression into a script', () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(checksOut(job), name).toBe(false);
      for (const step of job.steps) {
        expect(step.run ?? '', `${name}: ${step.name}`).not.toContain('${{');
        expect(step.run ?? '', `${name}: ${step.name}`).not.toMatch(/(^|\s)(\.\/|scripts\/|bun |node |npm )/);
      }
    }
    expect(text).not.toMatch(/secrets\./);
  });

  it('refuses a non-default ref in both jobs and gives cloud trust only to the environment-gated deploy job', () => {
    const { check, deploy: job } = workflow.jobs;
    expect(check!.permissions).toEqual({ contents: 'read', attestations: 'read' });
    expect(job!.permissions).toEqual({ 'id-token': 'write' });
    expect(job!.environment).toBe('${{ inputs.environment }}');
    expect(job!.needs).toBe('check');
    for (const steps of [check!.steps, job!.steps]) {
      expect(steps[0]?.run).toContain('if [ "$GITHUB_REF" != "refs/heads/$DEFAULT_BRANCH" ]; then');
    }
    expect(workflow.env?.DEFAULT_BRANCH).toBe('${{ github.event.repository.default_branch }}');
  });

  it('deploys the attested digest through the product SSM document', () => {
    const ssm = workflow.jobs.deploy!.steps.find((step) => step.id === 'ssm')?.run ?? '';
    expect(workflow.jobs.deploy!.env?.IMAGE).toBe('${{ needs.check.outputs.image }}');
    expect(ssm).toContain('--document-name "bookit-deploy-$PRODUCT"');
    expect(ssm).toContain('--targets "Key=tag:Name,Values=bookit-$ENVIRONMENT"');
    expect(ssm).toContain('deployment_id="$PRODUCT-$ENVIRONMENT-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"');
    const attestation = workflow.jobs.check!.steps.find((step) => step.id === 'attestation')?.run ?? '';
    expect(attestation).toContain('--source-digest "$SHA"');
    expect(attestation).toContain('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/ci.yml"');
  });
});
