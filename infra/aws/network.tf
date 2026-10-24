resource "aws_vpc" "bookit" {
  cidr_block           = "10.80.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "bookit-demo" }
}

# The default security group allows nothing, so nothing can be attached to it by mistake.
resource "aws_default_security_group" "bookit" {
  vpc_id = aws_vpc.bookit.id
}

resource "aws_internet_gateway" "bookit" {
  vpc_id = aws_vpc.bookit.id

  tags = { Name = "bookit-demo" }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.bookit.id
  cidr_block        = "10.80.1.0/24"
  availability_zone = "${var.region}a"

  tags = { Name = "bookit-demo-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.bookit.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.bookit.id
  }

  tags = { Name = "bookit-demo-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Ports 80 and 443 only, no SSH: administration is through Systems Manager Session Manager (plan 2.5).
resource "aws_security_group" "web" {
  name        = "bookit-web"
  description = "BookIt public web traffic; no SSH"
  vpc_id      = aws_vpc.bookit.id

  tags = { Name = "bookit-web" }
}

resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each = toset(["80", "443"])

  security_group_id = aws_security_group.web.id
  description       = "Public HTTP and HTTPS to Caddy"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
}

# Outbound HTTP and HTTPS only: image pulls, packages, Systems Manager, CloudWatch Logs and certificate issuance.
resource "aws_vpc_security_group_egress_rule" "web" {
  for_each = toset(["80", "443"])

  security_group_id = aws_security_group.web.id
  description       = "Outbound HTTP and HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
}
