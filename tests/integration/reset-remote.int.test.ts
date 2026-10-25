import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { processEnv, ROOT, type ChildEnv } from '../helpers/workflows';

// scripts/reset-remote.sh against a local bare repository standing in for GitHub, with a fake `gh` that serves pull
// requests and refs and performs the pull request merge in that repository (M0-34b, plan 2.5, F-42).

const REPOSITORY = 'IainLickerish/bookit-demo';
const APP = 'supportagents-demo-iainlickerish[bot]';
const SCRIPT = path.join(ROOT, 'scripts/reset-remote.sh');
const EVIDENCE_DIR = path.join(ROOT, 'test-results/M0-34b');
const evidence: Record<string, unknown>[] = [];

const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
echo "gh $*" >> "$FAKE_LOG"
bare="$FAKE_BARE"
case "$*" in
  "api repos/${REPOSITORY}")
    printf '{"default_branch":"main","permissions":{"admin":%s}}\\n' "$FAKE_ADMIN" ;;
  "api --paginate repos/${REPOSITORY}/pulls?state=open&per_page=100")
    cat "$FAKE_DIR/pulls.json" ;;
  "api --paginate repos/${REPOSITORY}/git/matching-refs/heads/sa/")
    git -C "$bare" for-each-ref --format='%(refname) %(objectname)' refs/heads/sa/ |
      jq -R -s 'split("\\n") | map(select(length > 0) | split(" ") | {ref: .[0], object: {sha: .[1]}})' ;;
  "api repos/${REPOSITORY}/commits/"*)
    sha="\${2##*/}"
    cat "$FAKE_DIR/owners/$sha" ;;
  "pr close "*) ;;
  "api -X DELETE repos/${REPOSITORY}/git/refs/heads/"*)
    git -C "$bare" update-ref -d "refs/heads/\${4#repos/${REPOSITORY}/git/refs/heads/}" ;;
  "repo clone ${REPOSITORY} "*)
    git clone --quiet --branch main "$bare" "$4" ;;
  "pr create "*)
    head="$(sed -E 's/.*--head ([^ ]+).*/\\1/' <<< "$*")"
    echo "$head" > "$FAKE_DIR/pr-head"
    echo "https://github.com/${REPOSITORY}/pull/99" ;;
  "pr merge 99 --repo ${REPOSITORY} --merge --admin")
    work="$FAKE_DIR/merge"
    git clone --quiet --branch main "$bare" "$work"
    git -C "$work" merge --quiet --no-ff -m "Merge pull request #99" "origin/$(cat "$FAKE_DIR/pr-head")"
    git -C "$work" push --quiet origin main
    git -C "$work" rev-parse HEAD > "$FAKE_DIR/merge-sha" ;;
  "pr view 99 --repo ${REPOSITORY} --json mergeCommit --jq .mergeCommit.oid")
    cat "$FAKE_DIR/merge-sha" ;;
  *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
`;

interface Fixture {
  dir: string;
  bare: string;
  log: string;
  env: ChildEnv;
  git: (...args: string[]) => string;
}

function fixture(admin = true, atBaseline = false): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'bookit-reset-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(path.join(dir, 'owners'));
  writeFileSync(path.join(bin, 'gh'), FAKE_GH);
  chmodSync(path.join(bin, 'gh'), 0o755);
  const log = path.join(dir, 'calls.log');
  writeFileSync(log, '');
  const env: ChildEnv = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: dir,
    TMPDIR: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'),
    GIT_AUTHOR_NAME: 'Owner',
    GIT_AUTHOR_EMAIL: 'owner@example.test',
    GIT_COMMITTER_NAME: 'Owner',
    GIT_COMMITTER_EMAIL: 'owner@example.test',
    FAKE_LOG: log,
    FAKE_DIR: dir,
    FAKE_BARE: path.join(dir, 'remote.git'),
    FAKE_ADMIN: String(admin),
  };
  writeFileSync(path.join(dir, 'gitconfig'), '[init]\n\tdefaultBranch = main\n');
  const git = (...args: string[]): string => {
    const result = spawnSync('git', args, { cwd: path.join(dir, 'seed'), env: processEnv(env), encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  mkdirSync(path.join(dir, 'seed'));
  git('init', '--quiet');
  writeFileSync(path.join(dir, 'seed/app.txt'), 'baseline\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'baseline');
  git('tag', 'demo-baseline');
  if (!atBaseline) {
    writeFileSync(path.join(dir, 'seed/app.txt'), 'fixed by an agent\n');
    writeFileSync(path.join(dir, 'seed/extra.txt'), 'new file\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'merged agent fix');
  }
  for (const branch of ['sa/inc-1', 'sa/manual']) {
    git('switch', '--quiet', '-c', branch, 'main');
    writeFileSync(path.join(dir, 'seed', `${branch.replace('/', '-')}.txt`), `${branch}\n`);
    git('add', '.');
    git('commit', '--quiet', '-m', branch);
    writeFileSync(
      path.join(dir, 'owners', git('rev-parse', 'HEAD')),
      branch === 'sa/inc-1' ? `${APP} web-flow\n` : 'IainLickerish IainLickerish\n',
    );
  }
  git('switch', '--quiet', 'main');
  spawnSync('git', ['clone', '--quiet', '--bare', path.join(dir, 'seed'), env.FAKE_BARE!], { env: processEnv(env) });
  writeFileSync(
    path.join(dir, 'pulls.json'),
    JSON.stringify([
      { number: 7, head: { ref: 'sa/inc-1', repo: { full_name: REPOSITORY } }, user: { login: APP } },
      { number: 8, head: { ref: 'sa/manual', repo: { full_name: REPOSITORY } }, user: { login: 'IainLickerish' } },
      { number: 9, head: { ref: 'sa/inc-1', repo: { full_name: 'someone/bookit-demo' } }, user: { login: APP } },
      {
        number: 10,
        head: { ref: 'build/m0-34b', repo: { full_name: 'iainlickerish-agent/bookit-demo' } },
        user: { login: 'iainlickerish-agent' },
      },
    ]),
  );
  return { dir, bare: env.FAKE_BARE!, log, env, git };
}

function reset(f: Fixture, args: string[], extraEnv: ChildEnv = {}) {
  const result = spawnSync('bash', [SCRIPT, ...args], { env: processEnv({ ...f.env, ...extraEnv }), encoding: 'utf8' });
  const calls = readFileSync(f.log, 'utf8').split('\n').filter(Boolean);
  console.log(`[reset-remote ${args.join(' ')}] exit ${result.status}\n${result.stdout}${result.stderr}`);
  evidence.push({ args, exit: result.status, stdout: result.stdout, stderr: result.stderr, calls });
  return { ...result, calls };
}

function bareGit(f: Fixture, ...args: string[]): string {
  return spawnSync('git', ['-C', f.bare, ...args], { env: processEnv(f.env), encoding: 'utf8' }).stdout.trim();
}

const MUTATING = /^gh (pr close|pr create|pr merge|api -X DELETE)/;

afterAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, 'reset-remote.json'),
    `${JSON.stringify({ test: 'M0-34b reset-remote.sh', runs: evidence }, null, 2)}\n`,
  );
});

describe('M0-34b REQ-18.3-02 F-42 reset-remote.sh (owner-only demo reset)', () => {
  it('refuses on the build server before any GitHub call', () => {
    const f = fixture();
    const result = reset(f, ['--app-login', APP, '--yes'], { SA_HOST_ROLE: 'build' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refused: this is the SupportAgents build server (SA_HOST_ROLE=build)');
    expect(result.calls).toEqual([]);
  });

  it('refuses a GitHub sign-in that is not a repository admin, such as the agents’ account', () => {
    const f = fixture(false);
    const result = reset(f, ['--app-login', APP, '--yes']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not an admin of IainLickerish/bookit-demo');
    expect(result.calls).toEqual([`gh api repos/${REPOSITORY}`]);
  });

  it('refuses without the App login', () => {
    const f = fixture();
    const result = reset(f, ['--yes']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--app-login must be the App');
    expect(result.calls).toEqual([]);
  });

  it('dry run lists only the App’s own sa/* work and changes nothing', () => {
    const f = fixture();
    const before = bareGit(f, 'for-each-ref', '--format=%(refname) %(objectname)');
    const result = reset(f, ['--app-login', APP, '--dry-run']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Pull requests to close: 1\n    #7 sa/inc-1\n');
    expect(result.stdout).toContain('Branches to delete: 1\n    sa/inc-1\n');
    expect(result.stdout).toContain("Left open (not the App's): #8 sa/manual by IainLickerish");
    expect(result.stdout).toContain("Left open (not the App's): #9 sa/inc-1 by " + APP);
    expect(result.stdout).not.toContain('#10');
    expect(result.stdout).toContain("Left in place (not the App's): sa/manual");
    expect(result.stdout).toContain('Dry run: nothing was changed.');
    expect(result.calls.filter((call) => MUTATING.test(call))).toEqual([]);
    expect(bareGit(f, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(before);
  });

  it('closes the App’s pull request, deletes its branch and restores demo-baseline with a new merged commit', () => {
    const f = fixture();
    const oldHead = bareGit(f, 'rev-parse', 'main');
    const baselineTree = bareGit(f, 'rev-parse', 'demo-baseline^{tree}');
    const tag = bareGit(f, 'rev-parse', 'demo-baseline');
    const result = reset(f, ['--app-login', APP, '--yes']);
    expect(result.status).toBe(0);
    const mutating = result.calls.filter((call) => MUTATING.test(call));
    expect(mutating[0]).toBe(
      `gh pr close 7 --repo ${REPOSITORY} --comment Closed by the demo reset (scripts/reset-remote.sh).`,
    );
    expect(mutating[1]).toBe(`gh api -X DELETE repos/${REPOSITORY}/git/refs/heads/sa/inc-1`);
    expect(mutating.filter((call) => call.startsWith('gh pr close'))).toHaveLength(1);
    expect(mutating.some((call) => call.includes('sa/manual'))).toBe(false);
    const newHead = bareGit(f, 'rev-parse', 'main');
    expect(bareGit(f, 'rev-parse', 'main^{tree}')).toBe(baselineTree);
    expect(newHead).not.toBe(oldHead);
    expect(spawnSync('git', ['-C', f.bare, 'merge-base', '--is-ancestor', oldHead, 'main']).status).toBe(0);
    expect(bareGit(f, 'rev-parse', 'demo-baseline')).toBe(tag);
    expect(bareGit(f, 'for-each-ref', '--format=%(refname)', 'refs/heads/')).toBe(
      'refs/heads/main\nrefs/heads/sa/manual',
    );
    const lines = result.stdout.trim().split('\n');
    expect(lines.at(-2)).toBe(newHead);
  });

  it('prints the default branch head when it already has the demo-baseline files', () => {
    const f = fixture(true, true);
    const head = bareGit(f, 'rev-parse', 'main');
    const result = reset(f, ['--app-login', APP, '--yes']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('main already has the demo-baseline files.');
    expect(result.calls.some((call) => call.startsWith('gh pr create'))).toBe(false);
    expect(result.stdout.trim().split('\n').at(-2)).toBe(head);
  });
});
