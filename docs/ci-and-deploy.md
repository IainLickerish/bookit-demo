# CI, deployment and demo reset

BookIt's GitHub Actions workflows make sure code written by an agent never reaches an environment unless a person
merged it (plan 2.5, F-01, F-38, F-41, HC-02). This page says what each workflow does and what the owner sets up once.

## `ci` (`.github/workflows/ci.yml`)

| Job              | Runs on                                                        | Permissions                               | What it does                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-approval` | Pull requests from `sa/**` branches or opened by a bot         | none                                      | Waits for approval of the `agent-ci` environment, which holds no secrets (F-01).                                                                                                     |
| `test`           | Every push except `sa/**`, every pull request (after approval) | read                                      | Typecheck, lint, formatting, unit (including actionlint), integration and browser tests. This is the **required check `test`** for the `default-branch` ruleset.                     |
| `image`          | Same as `test`                                                 | read                                      | Builds the image with `GIT_COMMIT`, `BUILD_ID` and `BOOKIT_IMAGE`, runs it with Compose and fails unless `/api/version` reports exactly the built commit (F-38).                     |
| `publish`        | Pushes to the default branch only                              | packages, id-token and attestations write | Checks out nothing. Pushes the image `image` verified as `ghcr.io/<owner>/bookit-demo:<sha>`, records its digest in the run summary and attests that `ci` built it from that commit. |

A push to an `sa/**` branch starts no workflow. Every job runs on a fresh GitHub-hosted runner. No job reads a
repository secret. Only `publish`, which runs no repository code, can request a cloud identity token.

## `deploy` (`.github/workflows/deploy.yml`)

A person starts it from **Actions → deploy → Run workflow**, on the default branch, with:

- `product`: `acme` or `beacon`;
- `environment`: `staging` or `production`;
- `sha`: the full commit SHA to deploy;
- `dry_run`: tick it to run only the checks.

The `check` job refuses, with the reason in the log:

- a run from any branch other than the default branch;
- a product not listed in `BOOKIT_PRODUCTS`;
- a SHA that is malformed or not reachable from the default branch head, using GitHub's compare API;
- a SHA without a published image;
- an image whose build attestation is not from `ci` on the default branch for that SHA.

The `deploy` job runs in the `staging` or `production` environment. Production waits for the Tech Lead's approval. The
job then:

1. assumes `BOOKIT_DEPLOYER_ROLE` through GitHub OIDC;
2. runs the product's SSM document `bookit-deploy-<product>` on the instance tagged `bookit-<environment>`, giving it
   the image **by digest** and a new `deploymentId`;
3. waits until `https://<host>/api/version` reports the SHA, the deployment ID, the product and the environment.

The instance's `static.env`, written by Terraform, sets `BOOKIT_PRODUCT`, `BOOKIT_TENANT` and `BOOKIT_ENV` (F-39). No
step checks out or runs repository code. SupportAgents' GitHub App has no Actions permission, so it cannot start
`deploy` (HC-02).

## Owner setup (once)

The agents' token cannot push workflow files, so the owner pushes this branch and merges its pull request. After the
merge, in the repository's **Settings**:

1. **Environments → New environment `agent-ci`.**
   - Add yourself (the Tech Lead) as a **required reviewer**.
   - Add no secrets and no variables.
2. **Environments → `staging`.**
   - Set **Deployment branches and tags** to **Selected branches**, then add the rule `main` only.
   - Add no secrets.
3. **Environments → `production`.**
   - Use the same branch rule as `staging`.
   - Add yourself as a **required reviewer**.
   - Tick **Prevent self-review** only if someone other than the person who starts deployments also reviews them.
4. **Secrets and variables → Actions → Variables.** Create these repository variables:
   - `BOOKIT_PRODUCTS`: `acme beacon`;
   - `BOOKIT_DEPLOYER_ROLE`: the `role_arn` of `bookit-deployer` from the Terraform `deployer_roles` output;
   - `BOOKIT_AWS_REGION`: the Terraform `region`;
   - `BOOKIT_DEMO_DOMAIN`: the Terraform `demo_domain`.
5. **OIDC subject template.** Follow `infra/aws/README.md`, "After applying", step 1.
6. **Image package.** After the first `publish` run, open the package `bookit-demo` under your GitHub profile's
   **Packages**. Set it to **Public** so the instances can pull it without credentials (`infra/aws/README.md`, step 4).
7. **Required check.** Follow SupportAgents setup guide M1-02 Part F, and add the check named **`test`**.

The deploy workflow cannot work until the AWS demo account exists (setup guide M1-05). Use `dry_run` to try the checks
before then: the checks need only the published image and its attestation.

## Demo reset (`scripts/reset-remote.sh`)

Owner-only. Run it from your own computer, never on the build server. You need bash 5, `gh` signed in with your own
admin account, `git` and `jq`.

```sh
scripts/reset-remote.sh --app-login '<app-slug>[bot]' --dry-run   # shows what it would do
scripts/reset-remote.sh --app-login '<app-slug>[bot]'              # asks you to type "reset"
```

The script:

1. closes the App's open pull requests from `sa/*` branches and deletes the App's `sa/*` branches, leaving anyone
   else's pull requests and branches alone;
2. restores the default branch's files to the tag `demo-baseline` (`git read-tree -u --reset demo-baseline`). It does
   this as a new commit, through a pull request it merges with your admin bypass, so history is never rewritten;
3. prints the SHA to deploy.

Wait for `ci` to publish that SHA's image. Then run `deploy` for each product to `staging`, then to `production`.
