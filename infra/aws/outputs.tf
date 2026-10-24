output "host_addresses" {
  description = "Public address for each hostname. Create these A records when dns_zone_id is null."
  value       = { for k, d in local.deployments : d.hostname => aws_eip.bookit[d.environment].public_ip }
}

output "instance_ids" {
  description = "Instance IDs for bookit-staging and bookit-production, used by the deploy workflow."
  value       = { for env in local.environments : env => aws_instance.bookit[env].id }
}

output "log_groups" {
  description = "CloudWatch log group for each product and environment."
  value       = { for k, d in local.deployments : k => aws_cloudwatch_log_group.bookit[k].name }
}

output "log_read_roles" {
  description = "Per-product read role ARNs and the IAM user that assumes each. Create the user's access key by hand."
  value = {
    for p in local.products : p => {
      role_arn = aws_iam_role.logs_read[p].arn
      user     = aws_iam_user.logs_reader[p].name
    }
  }
}

output "deployer_roles" {
  description = "Deployer role ARN per role, with its repository and products. Set BOOKIT_DEPLOYER_ROLE and BOOKIT_PRODUCTS from this."
  value = {
    for role, d in local.deployers : role => {
      role_arn          = aws_iam_role.deployer[role].arn
      github_repository = d.github_repository
      products          = d.products
      oidc_subjects     = local.deployer_subjects[role]
    }
  }
}

output "deploy_documents" {
  description = "SSM command document name per product."
  value       = { for p in local.products : p => aws_ssm_document.deploy[p].name }
}

output "github_oidc_subject_claim_keys" {
  description = "Claim keys each product repository's OIDC subject template must use (README, owner step)."
  value       = ["repo", "context", "job_workflow_ref"]
}
