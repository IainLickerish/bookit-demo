terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
  }
}

provider "aws" {
  region = var.region

  # Refuses to touch any account other than the demo account the owner names.
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project   = "bookit-demo"
      ManagedBy = "terraform"
      Source    = "bookit-demo/infra/aws"
    }
  }
}
