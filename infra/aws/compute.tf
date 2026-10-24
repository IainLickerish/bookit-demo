data "aws_iam_policy_document" "instance_trust" {
  statement {
    sid     = "EC2"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  for_each = toset(local.environments)

  name               = "bookit-${each.key}-instance"
  description        = "bookit-${each.key}: Session Manager and its own log groups"
  assume_role_policy = data.aws_iam_policy_document.instance_trust.json

  tags = { Environment = each.key }
}

resource "aws_iam_role_policy_attachment" "instance_ssm" {
  for_each = toset(local.environments)

  role       = aws_iam_role.instance[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# The awslogs driver writes with the instance role, only to this environment's log groups. The groups already exist.
data "aws_iam_policy_document" "instance_logs" {
  for_each = toset(local.environments)

  statement {
    sid       = "WriteOwnEnvironmentLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [for p in local.products : "${local.log_group_arns["${p}-${each.key}"]}:*"]
  }
}

resource "aws_iam_role_policy" "instance_logs" {
  for_each = toset(local.environments)

  name   = "write-${each.key}-logs"
  role   = aws_iam_role.instance[each.key].id
  policy = data.aws_iam_policy_document.instance_logs[each.key].json
}

resource "aws_iam_instance_profile" "instance" {
  for_each = toset(local.environments)

  name = "bookit-${each.key}-instance"
  role = aws_iam_role.instance[each.key].name
}

resource "aws_launch_template" "bookit" {
  for_each = toset(local.environments)

  name = "bookit-${each.key}"
  # Amazon Linux 2023, resolved by EC2 at launch, so planning needs no AWS lookup.
  image_id      = "resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
  instance_type = var.instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.instance[each.key].arn
  }

  # IMDSv2 only, one hop: the Docker daemon (awslogs) can reach it, containers cannot.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = 30
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  user_data = base64encode(templatefile("${path.module}/host/bootstrap.sh.tftpl", {
    environment            = each.key
    region                 = var.region
    compose_plugin_version = local.compose_plugin.version
    compose_plugin_sha256  = local.compose_plugin.sha256
    edge_compose_b64       = filebase64("${path.module}/host/edge.compose.yml")
    caddyfile_b64          = filebase64("${path.module}/../caddy/Caddyfile")
    product_compose_b64    = filebase64("${path.module}/host/product.compose.yml")
    products = [
      for p in local.products : {
        name       = p
        code       = local.tenants[p].product
        mail_from  = local.tenants[p].mailFrom
        hostname   = local.deployments["${p}-${each.key}"].hostname
        public_url = "https://${local.deployments["${p}-${each.key}"].hostname}"
      }
    ]
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "bookit-${each.key}", Environment = each.key }
  }
}

resource "aws_instance" "bookit" {
  for_each = toset(local.environments)

  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]

  launch_template {
    id      = aws_launch_template.bookit[each.key].id
    version = aws_launch_template.bookit[each.key].latest_version
  }

  tags = { Name = "bookit-${each.key}", Environment = each.key }
}

resource "aws_eip" "bookit" {
  for_each = toset(local.environments)

  domain   = "vpc"
  instance = aws_instance.bookit[each.key].id

  tags = { Name = "bookit-${each.key}" }

  depends_on = [aws_internet_gateway.bookit]
}

resource "aws_route53_record" "bookit" {
  for_each = var.dns_zone_id == null ? {} : local.deployments

  zone_id = var.dns_zone_id
  name    = each.value.hostname
  type    = "A"
  ttl     = 300
  records = [aws_eip.bookit[each.value.environment].public_ip]
}
