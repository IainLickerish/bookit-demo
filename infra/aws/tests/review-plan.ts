// Policy review over `terraform show -json` of a plan (M0-34a; plan 2.5, DR-005, F-41, HC-02). Every violation names
// the resource address. Usage: bun infra/aws/tests/review-plan.ts <plan.json> [evidence.json]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Violation {
  readonly address: string;
  readonly rule: string;
  readonly detail: string;
}

interface PlanResource {
  readonly address: string;
  readonly type: string;
  readonly name: string;
  readonly index?: string | number;
  readonly values: Record<string, unknown>;
}

interface Statement {
  readonly Sid?: string;
  readonly Effect?: string;
  readonly Action?: string | string[];
  readonly NotAction?: unknown;
  readonly Resource?: string | string[];
  readonly NotResource?: unknown;
  readonly Principal?: string | Record<string, string | string[]>;
  readonly NotPrincipal?: unknown;
  readonly Condition?: Record<string, Record<string, string | string[]>>;
}

interface Product {
  readonly github_repository: string;
  readonly image_repository: string;
  readonly deployer_role_name: string;
}

export const logReadActions = [
  'logs:DescribeLogStreams',
  'logs:FilterLogEvents',
  'logs:GetLogEvents',
  'logs:GetQueryResults',
  'logs:StartQuery',
  'logs:StopQuery',
];
const environments = ['staging', 'production'];
// Read-only SSM status calls that have no resource-level permissions; the only actions allowed on "*".
const statusActions = ['ssm:GetCommandInvocation', 'ssm:ListCommandInvocations'];

const list = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function resources(plan: unknown): PlanResource[] {
  const root = (plan as { planned_values?: { root_module?: { resources?: PlanResource[] } } }).planned_values
    ?.root_module;
  return root?.resources ?? [];
}

function variable<T>(plan: unknown, name: string): T {
  const value = (plan as { variables?: Record<string, { value: unknown }> }).variables?.[name]?.value;
  if (value === undefined) throw new Error(`plan has no variable ${name}`);
  return value as T;
}

function statements(address: string, json: unknown, violations: Violation[]): Statement[] {
  if (typeof json !== 'string') {
    violations.push({ address, rule: 'policy-known', detail: 'policy is not known at plan time' });
    return [];
  }
  const parsed = JSON.parse(json) as { Statement?: Statement | Statement[] };
  return Array.isArray(parsed.Statement) ? parsed.Statement : parsed.Statement ? [parsed.Statement] : [];
}

export function reviewPlan(plan: unknown): Violation[] {
  const violations: Violation[] = [];
  const fail = (address: string, rule: string, detail: string) => violations.push({ address, rule, detail });
  const all = resources(plan);
  const account = variable<string>(plan, 'aws_account_id');
  const region = variable<string>(plan, 'region');
  const branch = variable<string>(plan, 'github_default_branch');
  const products = variable<Record<string, Product>>(plan, 'products');
  const iam = `arn:aws:iam::${account}`;
  const logGroup = (product: string, env: string) =>
    `arn:aws:logs:${region}:${account}:log-group:/bookit/${product}/${env}`;
  const of = (type: string, name: string) => all.filter((r) => r.type === type && r.name === name);

  if (region !== 'eu-west-2') fail('var.region', 'region', `region is ${region}, expected eu-west-2`);

  // Every policy document in the plan: no wildcard principal, no wildcard or NotAction, no "*" resource except the
  // SSM status calls.
  const documents = all.flatMap((r) =>
    [r.values.policy, r.values.assume_role_policy]
      .filter((json) => json !== undefined)
      .map((json) => ({ address: r.address, list: statements(r.address, json, violations) })),
  );
  for (const { address, list: docStatements } of documents) {
    for (const s of docStatements) {
      if (s.Effect !== 'Allow') fail(address, 'allow-only', `statement ${s.Sid ?? '?'} is not a plain Allow`);
      if (s.NotAction || s.NotResource || s.NotPrincipal) fail(address, 'no-not-elements', `statement ${s.Sid ?? '?'}`);
      const principals = typeof s.Principal === 'string' ? [s.Principal] : Object.values(s.Principal ?? {}).flat();
      if (principals.some((p) => p.includes('*'))) fail(address, 'no-wildcard-principal', principals.join(', '));
      for (const action of list(s.Action)) {
        if (action.includes('*')) fail(address, 'no-wildcard-action', action);
      }
      if (list(s.Resource).includes('*') && !list(s.Action).every((a) => statusActions.includes(a))) {
        fail(address, 'no-wildcard-resource', `${list(s.Action).join(', ')} on *`);
      }
    }
  }

  // Log read roles: read actions only, on the product's own two log groups only; trusted only by its own user.
  for (const product of Object.keys(products)) {
    const own = environments.flatMap((env) => [logGroup(product, env), `${logGroup(product, env)}:*`]);
    const policies = of('aws_iam_role_policy', 'logs_read').filter((r) => r.index === product);
    if (policies.length !== 1) fail(`aws_iam_role_policy.logs_read["${product}"]`, 'log-role-policy', 'missing');
    for (const r of policies) {
      const docStatements = statements(r.address, r.values.policy, violations);
      const actions = docStatements.flatMap((s) => list(s.Action));
      const targets = docStatements.flatMap((s) => list(s.Resource));
      for (const action of actions) {
        if (!logReadActions.includes(action)) fail(r.address, 'log-role-read-only', `action ${action}`);
      }
      for (const target of targets) {
        if (!own.includes(target)) fail(r.address, 'log-role-own-groups', `resource ${target}`);
      }
      if (!sameSet([...new Set(targets)], own)) fail(r.address, 'log-role-own-groups', 'does not cover both groups');
    }
    for (const r of of('aws_iam_role', 'logs_read').filter((x) => x.index === product)) {
      const trusted = statements(r.address, r.values.assume_role_policy, violations).flatMap((s) =>
        typeof s.Principal === 'object' ? list(s.Principal.AWS) : [],
      );
      if (!sameSet(trusted, [`${iam}:user/sa-logs-reader-${product}`])) {
        fail(r.address, 'log-role-trust', `trusted ${trusted.join(', ') || 'nobody'}`);
      }
    }
    for (const r of of('aws_iam_user_policy', 'logs_reader_assume').filter((x) => x.index === product)) {
      const docStatements = statements(r.address, r.values.policy, violations);
      const actions = docStatements.flatMap((s) => list(s.Action));
      const targets = docStatements.flatMap((s) => list(s.Resource));
      if (!sameSet(actions, ['sts:AssumeRole']) || !sameSet(targets, [`${iam}:role/sa-logs-read-${product}`])) {
        fail(r.address, 'log-user-assume-only', `${actions.join(', ')} on ${targets.join(', ')}`);
      }
    }
  }
  const userPolicies = all.filter((r) => r.type === 'aws_iam_user_policy');
  for (const r of userPolicies.filter((x) => x.name !== 'logs_reader_assume')) {
    fail(r.address, 'log-user-assume-only', 'unexpected user policy');
  }
  for (const r of all.filter((x) => x.type === 'aws_iam_user_policy_attachment' || x.type === 'aws_iam_policy')) {
    fail(r.address, 'no-managed-policies', 'only inline policies are reviewed and allowed');
  }

  // Deployer roles: trusted only by deploy.yml on the default branch of the role's repository (F-41), allowed to run
  // only their products' deploy documents on the BookIt instances.
  for (const r of of('aws_iam_role', 'deployer')) {
    const role = String(r.index);
    const repos = [...new Set(Object.values(products).filter((p) => p.deployer_role_name === role))].map(
      (p) => p.github_repository,
    );
    const repository = repos[0] ?? '';
    const subject = new RegExp(
      `^repo:${escape(repository)}:environment:(staging|production):job_workflow_ref:${escape(repository)}/\\.github/workflows/deploy\\.yml@refs/heads/${escape(branch)}$`,
    );
    for (const s of statements(r.address, r.values.assume_role_policy, violations)) {
      const federated = typeof s.Principal === 'object' ? list(s.Principal.Federated) : [];
      if (!sameSet(federated, [`${iam}:oidc-provider/token.actions.githubusercontent.com`])) {
        fail(r.address, 'deployer-trust-principal', federated.join(', ') || 'no federated principal');
      }
      if (!sameSet(list(s.Action), ['sts:AssumeRoleWithWebIdentity'])) {
        fail(r.address, 'deployer-trust-action', list(s.Action).join(', '));
      }
      const operators = Object.keys(s.Condition ?? {});
      if (!sameSet(operators, ['StringEquals'])) fail(r.address, 'deployer-trust-exact', operators.join(', '));
      const equals = s.Condition?.StringEquals ?? {};
      if (!sameSet(list(equals['token.actions.githubusercontent.com:aud']), ['sts.amazonaws.com'])) {
        fail(r.address, 'deployer-trust-audience', 'aud must be sts.amazonaws.com');
      }
      const subjects = list(equals['token.actions.githubusercontent.com:sub']);
      if (subjects.length === 0) fail(r.address, 'deployer-trust-pinned', 'no subject condition');
      for (const sub of subjects) {
        if (!subject.test(sub)) fail(r.address, 'deployer-trust-pinned', `subject ${sub}`);
      }
    }
  }
  for (const r of of('aws_iam_role_policy', 'deployer')) {
    const role = String(r.index);
    const ownDocuments = Object.entries(products)
      .filter(([, p]) => p.deployer_role_name === role)
      .map(([name]) => `arn:aws:ssm:${region}:${account}:document/bookit-deploy-${name}`);
    const instances = `arn:aws:ec2:${region}:${account}:instance/*`;
    for (const s of statements(r.address, r.values.policy, violations)) {
      const actions = list(s.Action);
      const targets = list(s.Resource);
      if (sameSet(actions, ['ssm:SendCommand'])) {
        for (const target of targets) {
          if (target === instances) {
            const names = list(s.Condition?.StringEquals?.['ssm:resourceTag/Name']);
            if (
              !sameSet(names, ['bookit-staging', 'bookit-production']) ||
              Object.keys(s.Condition ?? {}).length !== 1
            ) {
              fail(r.address, 'deployer-instances', 'instances must be limited by Name tag to the BookIt instances');
            }
          } else if (!ownDocuments.includes(target)) {
            fail(r.address, 'deployer-own-documents', `resource ${target}`);
          }
        }
      } else if (!actions.every((a) => statusActions.includes(a))) {
        fail(r.address, 'deployer-actions', `actions ${actions.join(', ')}`);
      }
    }
  }

  // Deploy documents accept only their own product's image, pinned by digest.
  for (const r of of('aws_ssm_document', 'deploy')) {
    const product = products[String(r.index)];
    const content = typeof r.values.content === 'string' ? JSON.parse(r.values.content) : undefined;
    const pattern = content?.parameters?.image?.allowedPattern;
    const expected = product ? `^${product.image_repository.replaceAll('.', '\\.')}@sha256:[0-9a-f]{64}$` : '';
    if (pattern !== expected) fail(r.address, 'document-own-image', `allowedPattern ${String(pattern)}`);
    if (!sameSet(content?.parameters?.environment?.allowedValues ?? [], environments)) {
      fail(r.address, 'document-environment', 'environment must be staging or production');
    }
  }

  // Managed policies: only Session Manager on the instance roles.
  for (const r of all.filter((x) => x.type === 'aws_iam_role_policy_attachment')) {
    if (r.name !== 'instance_ssm' || r.values.policy_arn !== 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore') {
      fail(r.address, 'managed-policy', String(r.values.policy_arn));
    }
  }

  // Network and instances: 80 and 443 only, no SSH; IMDSv2; encrypted disks.
  for (const r of all.filter((x) => x.type === 'aws_vpc_security_group_ingress_rule')) {
    const from = Number(r.values.from_port);
    const to = Number(r.values.to_port);
    if (r.values.ip_protocol !== 'tcp' || from !== to || ![80, 443].includes(from)) {
      fail(r.address, 'ingress-web-only', `${String(r.values.ip_protocol)} ${from}-${to}`);
    }
  }
  for (const r of all.filter((x) => x.type === 'aws_security_group' && Array.isArray(x.values.ingress))) {
    if ((r.values.ingress as unknown[]).length > 0) fail(r.address, 'ingress-web-only', 'inline ingress rules');
  }
  for (const r of all.filter((x) => x.type === 'aws_launch_template')) {
    const metadata = (r.values.metadata_options as { http_tokens?: string }[] | undefined)?.[0];
    if (metadata?.http_tokens !== 'required') fail(r.address, 'imdsv2', 'http_tokens must be required');
    const disks = (r.values.block_device_mappings as { ebs?: { encrypted?: string | boolean }[] }[] | undefined) ?? [];
    if (!disks.every((d) => String(d.ebs?.[0]?.encrypted) === 'true')) fail(r.address, 'encrypted-disk', 'unencrypted');
  }

  // Budget alarm at the owner's amount.
  // Terraform records a -var value as given, so a number can arrive as a string.
  const budget = Number(variable<number | string>(plan, 'budget_monthly_usd'));
  const budgets = all.filter((x) => x.type === 'aws_budgets_budget');
  if (budgets.length !== 1) fail('aws_budgets_budget', 'budget', `expected one budget, found ${budgets.length}`);
  for (const r of budgets) {
    if (Number(r.values.limit_amount) !== budget || r.values.limit_unit !== 'USD') {
      fail(r.address, 'budget', `limit ${String(r.values.limit_amount)} ${String(r.values.limit_unit)}`);
    }
  }

  return violations;
}

if (import.meta.main) {
  const [planPath, evidencePath] = process.argv.slice(2);
  if (!planPath) {
    console.error('Usage: bun infra/aws/tests/review-plan.ts <plan.json> [evidence.json]');
    process.exit(2);
  }
  const text = readFileSync(planPath, 'utf8');
  const violations = reviewPlan(JSON.parse(text));
  for (const v of violations) console.log(`VIOLATION ${v.rule} ${v.address}: ${v.detail}`);
  const reviewed = resources(JSON.parse(text)).length;
  console.log(`Reviewed ${reviewed} planned resources: ${violations.length} violation(s).`);
  if (evidencePath) {
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    const evidence = {
      testId: 'M0-34a.policy-review',
      ids: ['REQ-18.1-06', 'DR-009', 'REQ-17.1-03', 'REQ-15.3-02', 'F-41', 'F-21', 'DR-005'],
      plan: { path: planPath, sha256: createHash('sha256').update(text).digest('hex'), resources: reviewed },
      violations,
      pass: violations.length === 0 && reviewed > 0,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  process.exit(violations.length === 0 && reviewed > 0 ? 0 : 1);
}
