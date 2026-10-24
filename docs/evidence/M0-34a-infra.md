# M0-34a evidence: BookIt AWS Terraform

Bead `supportagents-m0-34a-u2j`, branch `build/m0-34a-aws-infra`, implementation commit `da0bc44`, run on
24 October 2026 on the SupportAgents build server. Nothing was applied, and no plan was run against an AWS account.
Plans ran in a container with no network and dummy keys.

## Tools

| Tool               | Version                                                   |
| ------------------ | --------------------------------------------------------- |
| Terraform          | 1.17.0 (release zip checked against HashiCorp SHA256SUMS) |
| AWS provider       | 6.70.0 (`infra/aws/.terraform.lock.hcl`, four platforms)  |
| tflint             | 0.65.0 (release zip checked against its checksums.txt)    |
| tflint AWS ruleset | 0.50.0                                                    |
| Caddy image        | `caddy:2.11.7@sha256:504a44d7…b489`                       |

## Results

| Check                                                        | Result                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terraform fmt -recursive -check`                            | exit 0                                                                                                                                                                       |
| `terraform validate`                                         | exit 0, "The configuration is valid."                                                                                                                                        |
| `tflint`                                                     | exit 0, no findings                                                                                                                                                          |
| Offline plan, default products                               | 43 to add; policy review: 0 violations                                                                                                                                       |
| Offline plan, Beacon moved to `bookit-demo-beacon` (C-07)    | 45 to add; policy review: 0 violations                                                                                                                                       |
| Policy review refuses seeded violations                      | cross-product log group, log write action, wildcard principal, `sa/probe` subject, `StringLike` subject, foreign deploy document, SSH ingress, IMDSv1, foreign image pattern |
| Caddy F-21 test                                              | strict_sni_host on every server; matching names 200; mismatched Host 421; unknown TLS name fails the handshake; known HTTP name 308 to HTTPS; unknown HTTP name aborted      |
| `bun x vitest run --config infra/aws/tests/vitest.config.ts` | 2 files, 18 tests passed                                                                                                                                                     |

Retained run folders (ignored by git, on the build server):

| Run                                                                         | `evidence.json` SHA-256                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `test-results/M0-34a.terraform/c86bf06f-2d04-48f1-b69e-e95fa175885b`        | `47be030f1e1de1a2e469067697b5ddff7286b2293447ac6c17aec914ce9af383` |
| `test-results/M0-34a.caddy-strict-sni/aa81930b-0e21-4fef-a398-08ef98807ae1` | `2375af8f043859fb51a8a35893181c82b75a56d421e2fb6381b7c5df62d7949b` |

The reviewed plan JSON (default products) has SHA-256
`99b2c41dba920585021bcee464409a3c683017a34c719e2553d233d6b1826d05`.

## BookIt suites on this branch

- `bun run lint`, `bun run typecheck` and `bun x prettier --check .`: pass.
- `bun run test:integration`: 8 files, 55 tests passed.
- `bun run test:unit`: 108 of 109 passed. `tests/unit/lint-rules.test.ts` ("rejects Date.now() outside the clock
  module") timed out at Vitest's 5-second default while the server's load average was about 40. An untouched copy of
  the base commit `8f57e52` failed the same test the same way at the same time, and the file passes on its own.
- End-to-end (Playwright) was not run: this branch adds only `infra/` files and one `.prettierignore` line.

## Not yet verified

- Deployment on AWS and the live test `bookit.deploy_refuses_non_default_ref.live` wait for the owner's apply (M0-SG12)
  and M1.
- The SSM deploy documents and host Compose files have not run on an EC2 instance. They are exercised when the deploy
  workflow (M0-34b) first runs after the owner applies.
