locals {
  environments = ["staging", "production"]
  products     = sort(keys(var.products))

  # Tenant facts come from the same files the application loads, so product codes and sender addresses cannot drift.
  tenants = { for p in local.products : p => jsondecode(file("${path.module}/../../tenants/${p}.json")) }

  # One Compose project per product and environment (plan 2.5).
  deployments = {
    for pair in setproduct(local.products, local.environments) : "${pair[0]}-${pair[1]}" => {
      product     = pair[0]
      environment = pair[1]
      hostname    = pair[1] == "production" ? "${pair[0]}.${var.demo_domain}" : "${pair[0]}-staging.${var.demo_domain}"
      log_group   = "/bookit/${pair[0]}/${pair[1]}"
    }
  }

  # ARNs are built from known inputs so every policy is fully known at plan time and can be reviewed offline.
  account_arn_prefix = "arn:aws:iam::${var.aws_account_id}"
  log_group_arns     = { for k, d in local.deployments : k => "arn:aws:logs:${var.region}:${var.aws_account_id}:log-group:${d.log_group}" }
  oidc_provider_arn  = "${local.account_arn_prefix}:oidc-provider/token.actions.githubusercontent.com"

  # Deployer roles, keyed by role name: the repository whose deploy.yml may assume it and the products it may deploy.
  deployers = {
    for role in distinct([for p in local.products : var.products[p].deployer_role_name]) : role => {
      github_repository = one(distinct([for p in local.products : var.products[p].github_repository if var.products[p].deployer_role_name == role]))
      products          = [for p in local.products : p if var.products[p].deployer_role_name == role]
    }
  }

  # GitHub subject claims accepted by each deployer role. The repository's OIDC subject template must include
  # repo, context and job_workflow_ref (README), so the claim pins deploy.yml on the default branch (F-41).
  deployer_subjects = {
    for role, d in local.deployers : role => [
      for env in local.environments :
      "repo:${d.github_repository}:environment:${env}:job_workflow_ref:${d.github_repository}/.github/workflows/deploy.yml@refs/heads/${var.github_default_branch}"
    ]
  }

  compose_plugin = {
    version = "v5.6.1"
    sha256  = "47737f4236e6d3ccea7291995203f8f018058783b4c3a9469119811a0b5db8c0"
  }
}
