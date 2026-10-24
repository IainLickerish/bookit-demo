# BookIt on AWS

Terraform for the BookIt demo's staging and production on AWS (SupportAgents plan 2.5, DR-009). The owner applies it
from their own machine with the demo account's administrator credentials. It is never applied from the build server
and never by SupportAgents.

## What it creates

All resources are in `eu-west-2` (London).

| Resource                                                                             | Detail                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC2 instances `bookit-staging` and `bookit-production`                               | Amazon Linux 2023 with Docker and the Compose plugin. Each runs Acme and Beacon as two Compose projects behind Caddy, each with its own database container. IMDSv2 only, encrypted disk, an Elastic IP.                            |
| Security group `bookit-web`                                                          | Inbound 80 and 443 only. No SSH: use Systems Manager Session Manager.                                                                                                                                                              |
| DNS                                                                                  | `acme-staging`, `acme`, `beacon-staging` and `beacon` under `demo_domain`. Created in Route 53 when `dns_zone_id` is set; otherwise create the A records from the `host_addresses` output.                                         |
| CloudWatch log groups                                                                | `/bookit/acme/staging`, `/bookit/acme/production`, `/bookit/beacon/staging`, `/bookit/beacon/production`, written by the Docker `awslogs` driver with the instance role.                                                           |
| IAM roles `sa-logs-read-acme`, `sa-logs-read-beacon`                                 | Read-only CloudWatch Logs actions on that product's two log groups only.                                                                                                                                                           |
| IAM users `sa-logs-reader-acme`, `sa-logs-reader-beacon`                             | Their only permission is `sts:AssumeRole` on their own product's read role.                                                                                                                                                        |
| GitHub OIDC provider and role `bookit-deployer` (and later `bookit-deployer-beacon`) | Trusted only by `.github/workflows/deploy.yml` on the default branch of the product's repository, for the `staging` and `production` environments (F-41). Allowed to run only its products' deploy documents on the two instances. |
| SSM command documents `bookit-deploy-acme`, `bookit-deploy-beacon`                   | Deploy one product by image digest. The image must be that product's own GHCR repository pinned by `@sha256:` digest, and the instance must run the requested environment.                                                         |
| Budget `bookit-demo-monthly`                                                         | Emails `budget_alert_email` at 80% of the monthly amount (actual) and 100% (forecast).                                                                                                                                             |

Caddy (`infra/caddy/Caddyfile`) sets `strict_sni_host on`, so a request whose Host header differs from the TLS server
name gets `421 Misdirected Request` (F-21). Plain HTTP for any other host name is aborted.

Database and account passwords are created on each instance at first deployment by BookIt's own
`scripts/local-credentials.ts`, inside the deployed image. They never pass through Terraform or its state.

## Applying (owner)

1. Copy `terraform.tfvars.example` to `terraform.tfvars` and set the account ID, demo domain, budget amount and alert
   address. The budget amount has no default; the example's USD 25 is a placeholder.
2. From `infra/aws`, run `terraform init`, then `terraform plan`, review it, and run `terraform apply`. The provider
   refuses to act on any account other than `aws_account_id`.
3. If `dns_zone_id` is null, create the four A records from the `host_addresses` output.

## After applying (owner)

1. **GitHub OIDC subject template.** The deployer trust expects a subject that includes the job workflow reference.
   For each product repository, set the repository's OIDC subject template with the GitHub REST API
   (`PUT /repos/{owner}/{repo}/actions/oidc/customization/sub`, token with `repo` scope) and this body:

   ```json
   { "use_default": false, "include_claim_keys": ["repo", "context", "job_workflow_ref"] }
   ```

   Leave `use_immutable_subject` unset or false: the immutable format uses repository IDs, which the trust does not
   accept. The `deployer_roles` output lists the exact subjects each role accepts.

2. **Deploy workflow variables.** Set `BOOKIT_DEPLOYER_ROLE` and `BOOKIT_PRODUCTS` in each product repository from the
   `deployer_roles` output, and give the workflow the `instance_ids` and `deploy_documents` outputs (M0-34b).
3. **Log reader keys.** Create an access key for `sa-logs-reader-acme` and for `sa-logs-reader-beacon`. Store each
   only where the SupportAgents setup guides say; never commit them.
4. **Image access.** The instances pull images from GHCR without registry credentials, so each product's GHCR package
   must allow anonymous pulls. If a package is private, deployments fail at the pull step.

## Moving Beacon to its own repository (owner decision C-07)

When `bookit-demo-beacon` exists, change `products.beacon` to that repository, its image
(`ghcr.io/<owner>/bookit-demo-beacon`) and the role name `bookit-deployer-beacon` (example in
`terraform.tfvars.example`), and apply once. Terraform then creates `bookit-deployer-beacon`, trusted only by
`bookit-demo-beacon`'s `deploy.yml`, and removes Beacon's document from `bookit-deployer`. Set the OIDC subject
template on the new repository as in step 1 above.

## Checks without an AWS account

These run on the build server with no cloud credentials. `terraform plan` runs in a container with no network and
dummy keys, so it cannot reach AWS.

```bash
cd infra/aws
terraform fmt -recursive -check
terraform init -backend=false
terraform validate
tflint --init && tflint
cd ../..
bun x vitest run --config infra/aws/tests/vitest.config.ts
```

The test run needs Terraform, tflint, Docker and curl. It writes evidence under `test-results/M0-34a.*/`.
`infra/aws/tests/review-plan.ts` is the policy review. It checks a plan's JSON (`terraform show -json`) and prints each
violation with its resource address.
