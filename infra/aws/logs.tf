resource "aws_cloudwatch_log_group" "bookit" {
  for_each = local.deployments

  name              = each.value.log_group
  retention_in_days = var.log_retention_days

  tags = { Product = each.value.product, Environment = each.value.environment }
}

# Per-product read access for SupportAgents (plan 2.5, DR-005): each product has its own IAM user whose only
# permission is to assume that product's read role, and the role reads only that product's two log groups.

resource "aws_iam_user" "logs_reader" {
  for_each = toset(local.products)

  name = "sa-logs-reader-${each.key}"

  tags = { Product = each.key }
}

data "aws_iam_policy_document" "logs_reader_assume" {
  for_each = toset(local.products)

  statement {
    sid       = "AssumeOwnProductLogRole"
    effect    = "Allow"
    actions   = ["sts:AssumeRole"]
    resources = ["${local.account_arn_prefix}:role/sa-logs-read-${each.key}"]
  }
}

resource "aws_iam_user_policy" "logs_reader_assume" {
  for_each = toset(local.products)

  name   = "assume-sa-logs-read-${each.key}"
  user   = aws_iam_user.logs_reader[each.key].name
  policy = data.aws_iam_policy_document.logs_reader_assume[each.key].json
}

data "aws_iam_policy_document" "logs_read_trust" {
  for_each = toset(local.products)

  statement {
    sid     = "OwnProductReaderOnly"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = ["${local.account_arn_prefix}:user/sa-logs-reader-${each.key}"]
    }
  }
}

resource "aws_iam_role" "logs_read" {
  for_each = toset(local.products)

  name                 = "sa-logs-read-${each.key}"
  description          = "SupportAgents read-only access to ${each.key} CloudWatch logs"
  assume_role_policy   = data.aws_iam_policy_document.logs_read_trust[each.key].json
  max_session_duration = 3600

  tags = { Product = each.key }

  depends_on = [aws_iam_user.logs_reader]
}

data "aws_iam_policy_document" "logs_read" {
  for_each = toset(local.products)

  statement {
    sid    = "ReadOwnProductLogs"
    effect = "Allow"
    actions = [
      "logs:DescribeLogStreams",
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
      "logs:GetQueryResults",
      "logs:StartQuery",
      "logs:StopQuery",
    ]
    resources = flatten([
      for env in local.environments : [
        local.log_group_arns["${each.key}-${env}"],
        "${local.log_group_arns["${each.key}-${env}"]}:*",
      ]
    ])
  }
}

resource "aws_iam_role_policy" "logs_read" {
  for_each = toset(local.products)

  name   = "read-${each.key}-logs"
  role   = aws_iam_role.logs_read[each.key].id
  policy = data.aws_iam_policy_document.logs_read[each.key].json
}
