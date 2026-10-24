# Human deployment route (plan 2.5, F-41). The deploy workflow assumes a deployer role through GitHub OIDC and may run
# only its products' SSM command documents on the two instances. SupportAgents cannot reach any of this (HC-02).

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# One command document per product. Parameters are restricted by pattern before SSM substitutes them into the script:
# the image must be this product's own repository pinned by digest, and the target instance must run the requested
# environment.
resource "aws_ssm_document" "deploy" {
  for_each = toset(local.products)

  name            = "bookit-deploy-${each.key}"
  document_type   = "Command"
  document_format = "JSON"
  target_type     = "/AWS::EC2::Instance"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy ${each.key} by image digest on this instance's environment"
    parameters = {
      environment = {
        type          = "String"
        description   = "staging or production; must match the instance"
        allowedValues = local.environments
      }
      image = {
        type           = "String"
        description    = "${var.products[each.key].image_repository}@sha256:<digest>"
        allowedPattern = "^${replace(var.products[each.key].image_repository, ".", "\\.")}@sha256:[0-9a-f]{64}$"
      }
      deploymentId = {
        type           = "String"
        description    = "A new identifier for this deployment (F-39)"
        allowedPattern = "^[A-Za-z0-9._-]{1,64}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "900"
        runCommand = split("\n", templatefile("${path.module}/host/deploy.sh.tftpl", {
          product = each.key
        }))
      }
    }]
  })

  tags = { Product = each.key }
}

data "aws_iam_policy_document" "deployer_trust" {
  for_each = local.deployers

  statement {
    sid     = "DeployWorkflowOnDefaultBranch"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.deployer_subjects[each.key]
    }
  }
}

resource "aws_iam_role" "deployer" {
  for_each = local.deployers

  name                 = each.key
  description          = "deploy.yml in ${each.value.github_repository} on ${var.github_default_branch}: ${join(", ", each.value.products)}"
  assume_role_policy   = data.aws_iam_policy_document.deployer_trust[each.key].json
  max_session_duration = 3600

  tags = { Products = join(" ", each.value.products) }

  depends_on = [aws_iam_openid_connect_provider.github]
}

data "aws_iam_policy_document" "deployer" {
  for_each = local.deployers

  statement {
    sid       = "RunOwnProductDeployDocuments"
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = [for p in each.value.products : "arn:aws:ssm:${var.region}:${var.aws_account_id}:document/bookit-deploy-${p}"]
  }

  # SendCommand authorises the document and each target instance separately. Instances are matched by their Name tag,
  # so the policy is fully known at plan time.
  statement {
    sid       = "OnBookItInstancesOnly"
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ec2:${var.region}:${var.aws_account_id}:instance/*"]

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Name"
      values   = [for env in local.environments : "bookit-${env}"]
    }
  }

  # These read-only status calls do not support resource-level permissions.
  statement {
    sid       = "ReadCommandStatus"
    effect    = "Allow"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deployer" {
  for_each = local.deployers

  name   = "deploy-${join("-", each.value.products)}"
  role   = aws_iam_role.deployer[each.key].id
  policy = data.aws_iam_policy_document.deployer[each.key].json
}
