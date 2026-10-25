# M0-34b: CI and deploy workflows, demo reset

SilentHeron, 24 October 2026. Bead `supportagents-m0-34b-usz`. IDs covered: REQ-18.1-06, REQ-15.3-02, DR-009,
REQ-18.3-02, F-01, F-38, F-39, F-41, HC-02.

Files:

- `.github/workflows/ci.yml` and `deploy.yml`;
- `.github/actionlint.yaml`;
- `scripts/reset-remote.sh`;
- `docs/ci-and-deploy.md`;
- `tests/unit/workflows.test.ts`;
- `tests/integration/deploy-dry-run.int.test.ts` and `reset-remote.int.test.ts`;
- `tests/helpers/workflows.ts`;
- the `yaml` dev dependency.

The agents' token cannot push workflow files, so the owner pushes this branch.

## Results on the build server (Node 24.22.1, Bun 1.4.4)

- **Workflow lint (unit, 11/11).**
  - actionlint 1.7.12 reports no findings, with shellcheck 0.11.0.
  - Every action is pinned to a commit SHA.
  - Only `publish` has package, id-token or attestation write. It runs only on default-branch pushes and checks out
    nothing.
  - Every other job is read-only, on GitHub-hosted runners, with no secrets. `sa/**` pushes are ignored.
  - Agent pull requests wait for `agent-ci`.
  - `deploy.yml` is manual-only, with `permissions: {}`. It checks out nothing and interpolates no expression into a
    script. Only the environment-gated deploy job holds `id-token: write`.
- **Deploy dry-run harness (integration, 11/11).** It runs `deploy.yml`'s own `check` steps with GitHub's bash options
  and fake `gh` and `docker`. It refuses, each with the reason printed:
  - a non-default ref (`refs/heads/sa/inc-42`);
  - a product not in `BOOKIT_PRODUCTS`, and any product when the variable is empty;
  - a malformed SHA;
  - a SHA that is diverged, ahead or missing;
  - a SHA without an image;
  - an image without a matching attestation.

  It passes a listed product with an attested SHA, and the default-branch head itself. The ref and product refusals make
  no GitHub call. Bundle `test-results/M0-34b/deploy-dry-run.json`, sha256
  `6f0def73654d8af2762d2b104091333def8178530b9d8f693db5d01a651392f8`.

- **`reset-remote.sh` (integration, 6/6).** It runs against a local bare repository and a fake `gh`.
  - It refuses on the build server (`SA_HOST_ROLE=build`) and without `--app-login`, before any GitHub call.
  - It refuses a non-admin sign-in.
  - The dry run lists only the App's own `sa/*` pull request and branch, and changes nothing.
  - The full run closes only PR #7 and deletes only `sa/inc-1`. `sa/manual`, a human PR, a fork PR and a `build/` PR
    are untouched.
  - `main` gets a new merge commit whose tree equals `demo-baseline`. The old head stays an ancestor, the tag is
    unchanged and the reset branch is deleted.
  - When `main` already has the baseline files, it prints the head without opening a PR.

  Bundle `test-results/M0-34b/reset-remote.json`, sha256
  `037294df2a3b83d8bde6973dedb25b7e62f3b6a089a35d81e85a8a931994a350`.

- **F-38 image check, run locally.** `ci.yml`'s own `image` build step and `/api/version` step ran on this server. They
  built `ghcr.io/iainlickerish/bookit-demo:5fd8381a…` (image ID `sha256:fff25d58…`), started it with Compose, and the
  step printed `/api/version reports exactly 5fd8381a12cb1806e5f57c31a8af153f7559aab0.` The first attempt failed inside
  `next build` on a test type error, which the build typechecks; that error was fixed.
- **Full suite.** Typecheck, lint and format pass. Unit 133/133, integration 82/82 and browser 20/20 pass.

## Not yet proven (blocked on owner steps, never claimed as passed)

These wait for the owner to push and merge the workflows, then for the owner settings in `docs/ci-and-deploy.md`:

- a real GitHub run of `ci`, including `publish` and its attestation;
- the gating of the first `sa/**` pull request;
- a fork pull request run (bead `supportagents-mq2w`);
- a real `deploy` dry run.

Live tests `bookit.sa_branch_ci_gated.live`, `bookit.version_endpoint_attested.live` and
`bookit.deploy_refuses_non_default_ref.live` belong to M1-TLIVE.
