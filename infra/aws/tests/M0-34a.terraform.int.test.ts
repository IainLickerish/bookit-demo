import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewPlan, type Violation } from './review-plan';
import { moduleDir, run, runFolder, writeEvidence, type Observation } from './support';

// M0-34a: BookIt AWS Terraform is written and validated only. Plans run offline in a container with no network and
// dummy keys; nothing is applied or planned against an AWS account.
const testId = 'M0-34a.terraform';
const ids = ['REQ-18.1-06', 'DR-009', 'REQ-17.1-03', 'REQ-15.3-02', 'F-41', 'F-21', 'DR-005', 'HC-02'];
const observations: Observation[] = [];
const folder = runFolder(testId);

function record(assertion: string, expected: unknown, observed: unknown): void {
  observations.push({ assertion, expected, observed, pass: JSON.stringify(expected) === JSON.stringify(observed) });
  expect(observed, assertion).toEqual(expected);
}

interface Plan {
  planned_values: { root_module: { resources: { address: string; values: Record<string, unknown> }[] } };
  variables: Record<string, { value: unknown }>;
}

function offlinePlan(name: string, extra: string[] = []): Plan {
  const out = path.join(folder, name);
  const result = run('bash', [path.join(moduleDir, 'tests/offline-plan.sh'), out, ...extra]);
  if (result.code !== 0) throw new Error(`offline plan ${name} failed: ${result.stderr}`);
  return JSON.parse(readFileSync(path.join(out, 'plan.json'), 'utf8')) as Plan;
}

const switchedProducts =
  '{acme={github_repository="IainLickerish/bookit-demo",image_repository="ghcr.io/iainlickerish/bookit-demo",deployer_role_name="bookit-deployer"},beacon={github_repository="IainLickerish/bookit-demo-beacon",image_repository="ghcr.io/iainlickerish/bookit-demo-beacon",deployer_role_name="bookit-deployer-beacon"}}';

let plan: Plan;
let switched: Plan;

const resource = (p: Plan, address: string) => {
  const found = p.planned_values.root_module.resources.find((r) => r.address === address);
  if (!found) throw new Error(`no resource ${address}`);
  return found;
};
const policy = (p: Plan, address: string, key = 'policy') =>
  JSON.parse(resource(p, address).values[key] as string) as { Statement: Record<string, unknown>[] };
const rules = (violations: Violation[]) => [...new Set(violations.map((v) => v.rule))].sort();

/** Applies one change to a copy of the plan and returns the review's rule names. */
function mutate(change: (p: Plan) => void): string[] {
  const copy = structuredClone(plan);
  change(copy);
  return rules(reviewPlan(copy));
}
function setPolicy(
  p: Plan,
  address: string,
  edit: (doc: { Statement: Record<string, unknown>[] }) => void,
  key = 'policy',
) {
  const doc = policy(p, address, key);
  edit(doc);
  resource(p, address).values[key] = JSON.stringify(doc);
}

beforeAll(() => {
  plan = offlinePlan('default');
  switched = offlinePlan('beacon-switch', ['-var', `products=${switchedProducts}`]);
});

describe('M0-34a REQ-18.1-06 DR-009 REQ-17.1-03 unit: fmt, validate and tflint', () => {
  it('is formatted', () => {
    record('terraform fmt -check exit', 0, run('terraform', ['fmt', '-recursive', '-check'], moduleDir).code);
  });

  it('validates', () => {
    const result = run('terraform', ['validate', '-no-color'], moduleDir);
    record('terraform validate exit', 0, result.code);
    record('terraform validate message', true, result.stdout.includes('The configuration is valid.'));
  });

  it('is tflint clean', () => {
    const result = run('tflint', ['--format', 'compact'], moduleDir);
    record('tflint findings', '', result.stdout.trim());
    record('tflint exit', 0, result.code);
  });
});

describe('M0-34a REQ-15.3-02 DR-005 F-41 integration: policy review of offline plans', () => {
  it('plans the full footprint with no violations', () => {
    const count = plan.planned_values.root_module.resources.length;
    record('planned resources', true, count > 40);
    record('violations (default products)', [], reviewPlan(plan));
  });

  it('gives each product read access to its own two log groups only', () => {
    for (const product of ['acme', 'beacon']) {
      const statement = policy(plan, `aws_iam_role_policy.logs_read["${product}"]`).Statement[0]!;
      const groups = [...new Set((statement.Resource as string[]).map((r) => r.replace(/:\*$/, '').split(':').pop()))];
      record(`${product} log groups`, [`/bookit/${product}/production`, `/bookit/${product}/staging`], groups.sort());
    }
  });

  it('pins the deployer trust to deploy.yml on the default branch (F-41)', () => {
    const trust = policy(plan, 'aws_iam_role.deployer["bookit-deployer"]', 'assume_role_policy').Statement[0]!;
    const condition = trust.Condition as Record<string, Record<string, unknown>>;
    record(
      'deployer trust subjects',
      [
        'repo:IainLickerish/bookit-demo:environment:staging:job_workflow_ref:IainLickerish/bookit-demo/.github/workflows/deploy.yml@refs/heads/main',
        'repo:IainLickerish/bookit-demo:environment:production:job_workflow_ref:IainLickerish/bookit-demo/.github/workflows/deploy.yml@refs/heads/main',
      ],
      condition.StringEquals!['token.actions.githubusercontent.com:sub'],
    );
  });

  it('moves Beacon to its own repository and deployer with one variable change (C-07)', () => {
    record('violations (Beacon switched)', [], reviewPlan(switched));
    const roles = switched.planned_values.root_module.resources
      .filter((r) => r.address.startsWith('aws_iam_role.deployer['))
      .map((r) => r.address);
    record(
      'deployer roles after switch',
      ['aws_iam_role.deployer["bookit-deployer"]', 'aws_iam_role.deployer["bookit-deployer-beacon"]'],
      roles.sort(),
    );
    const beacon = policy(switched, 'aws_iam_role_policy.deployer["bookit-deployer-beacon"]').Statement[0]!;
    record(
      'beacon deployer documents',
      ['arn:aws:ssm:eu-west-2:123456789012:document/bookit-deploy-beacon'],
      [beacon.Resource].flat(),
    );
  });
});

describe('M0-34a security F-41 DR-005 HC-02: the review refuses unsafe policies', () => {
  it('refuses cross-product log access', () => {
    const found = mutate((p) =>
      setPolicy(p, 'aws_iam_role_policy.logs_read["acme"]', (doc) => {
        (doc.Statement[0]!.Resource as string[]).push(
          'arn:aws:logs:eu-west-2:123456789012:log-group:/bookit/beacon/production',
        );
      }),
    );
    record('cross-product log resource', ['log-role-own-groups'], found);
  });

  it('refuses a write action on a log read role', () => {
    const found = mutate((p) =>
      setPolicy(p, 'aws_iam_role_policy.logs_read["beacon"]', (doc) => {
        (doc.Statement[0]!.Action as string[]).push('logs:PutLogEvents');
      }),
    );
    record('log write action', ['log-role-read-only'], found);
  });

  it('refuses a wildcard principal', () => {
    const found = mutate((p) =>
      setPolicy(
        p,
        'aws_iam_role.logs_read["acme"]',
        (doc) => {
          doc.Statement[0]!.Principal = { AWS: '*' };
        },
        'assume_role_policy',
      ),
    );
    record('wildcard principal', ['log-role-trust', 'no-wildcard-principal'], found);
  });

  it('refuses a deployer trust that accepts an sa/* branch or a pattern (F-41)', () => {
    const branch = mutate((p) =>
      setPolicy(
        p,
        'aws_iam_role.deployer["bookit-deployer"]',
        (doc) => {
          const c = doc.Statement[0]!.Condition as Record<string, Record<string, string[]>>;
          c.StringEquals!['token.actions.githubusercontent.com:sub'] = [
            'repo:IainLickerish/bookit-demo:environment:staging:job_workflow_ref:IainLickerish/bookit-demo/.github/workflows/deploy.yml@refs/heads/sa/probe',
          ];
        },
        'assume_role_policy',
      ),
    );
    record('sa/* branch subject', ['deployer-trust-pinned'], branch);
    const pattern = mutate((p) =>
      setPolicy(
        p,
        'aws_iam_role.deployer["bookit-deployer"]',
        (doc) => {
          const c = doc.Statement[0]!.Condition as Record<string, Record<string, unknown>>;
          c.StringLike = { 'token.actions.githubusercontent.com:sub': 'repo:IainLickerish/bookit-demo:*' };
        },
        'assume_role_policy',
      ),
    );
    record('pattern subject', ['deployer-trust-exact'], pattern);
  });

  it("refuses a deployer allowed another product's document", () => {
    const found = mutate((p) => {
      const products = p.variables.products!.value as Record<string, Record<string, string>>;
      products.beacon!.deployer_role_name = 'bookit-deployer-beacon';
    });
    record('foreign deploy document', ['deployer-own-documents'], found);
  });

  it('refuses SSH, IMDSv1 and a document that accepts another image', () => {
    const ssh = mutate((p) => {
      const rule = resource(p, 'aws_vpc_security_group_ingress_rule.web["443"]');
      rule.values.from_port = 22;
      rule.values.to_port = 22;
    });
    record('SSH ingress', ['ingress-web-only'], ssh);
    const imds = mutate((p) => {
      const options = resource(p, 'aws_launch_template.bookit["staging"]').values.metadata_options as Record<
        string,
        unknown
      >[];
      options[0]!.http_tokens = 'optional';
    });
    record('IMDSv1', ['imdsv2'], imds);
    const image = mutate((p) => {
      const doc = resource(p, 'aws_ssm_document.deploy["acme"]');
      const content = JSON.parse(doc.values.content as string);
      content.parameters.image.allowedPattern = '^ghcr\\.io/.*$';
      doc.values.content = JSON.stringify(content);
    });
    record('document image pattern', ['document-own-image'], image);
  });
});

afterAll(() => {
  writeEvidence(folder, testId, ids, observations);
});
