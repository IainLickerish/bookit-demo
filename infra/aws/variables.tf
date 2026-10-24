variable "aws_account_id" {
  description = "The demo AWS account ID. The provider refuses to act on any other account."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account ID."
  }
}

variable "region" {
  description = "AWS region. Fixed to London so demo data stays in the UK (plan 2.5, REQ-9.6-02)."
  type        = string
  default     = "eu-west-2"

  validation {
    condition     = var.region == "eu-west-2"
    error_message = "The BookIt demo runs only in eu-west-2 (London)."
  }
}

variable "demo_domain" {
  description = "The demo domain chosen in the owner's setup guide, for example demo.example.com. Hosts are acme-staging, acme, beacon-staging and beacon under it."
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.demo_domain))
    error_message = "demo_domain must be a lower-case DNS name such as demo.example.com."
  }
}

variable "dns_zone_id" {
  description = "Optional Route 53 hosted zone ID for demo_domain. When null, create the four A records by hand from the host_addresses output."
  type        = string
  default     = null
}

variable "budget_monthly_usd" {
  description = "Monthly cost budget in USD for the billing alarm. Required, with no default: the owner sets the amount when applying."
  type        = number

  validation {
    condition     = var.budget_monthly_usd > 0
    error_message = "budget_monthly_usd must be greater than zero."
  }
}

variable "budget_alert_email" {
  description = "Address that receives the budget alarm emails."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email must be an email address."
  }
}

variable "github_default_branch" {
  description = "Default branch of the product repositories. The deployer trust accepts deploy.yml only from this branch (F-41)."
  type        = string
  default     = "main"

  validation {
    condition     = can(regex("^[A-Za-z0-9._/-]+$", var.github_default_branch))
    error_message = "github_default_branch must be a plain branch name."
  }
}

variable "products" {
  description = <<-EOT
    Per-product source, image and deployer (owner decision C-07). Until bookit-demo-beacon exists both products use
    bookit-demo and the bookit-deployer role. At the switch, set beacon to the bookit-demo-beacon repository and image
    and to the bookit-deployer-beacon role, then apply once.
  EOT
  type = map(object({
    github_repository  = string
    image_repository   = string
    deployer_role_name = string
  }))
  default = {
    acme = {
      github_repository  = "IainLickerish/bookit-demo"
      image_repository   = "ghcr.io/iainlickerish/bookit-demo"
      deployer_role_name = "bookit-deployer"
    }
    beacon = {
      github_repository  = "IainLickerish/bookit-demo"
      image_repository   = "ghcr.io/iainlickerish/bookit-demo"
      deployer_role_name = "bookit-deployer"
    }
  }

  validation {
    condition     = toset(keys(var.products)) == toset(["acme", "beacon"])
    error_message = "products must define exactly acme and beacon."
  }

  validation {
    condition     = alltrue([for p in values(var.products) : can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", p.github_repository))])
    error_message = "github_repository must be owner/name."
  }

  validation {
    condition     = alltrue([for p in values(var.products) : can(regex("^ghcr\\.io/[a-z0-9-]+/[a-z0-9._-]+$", p.image_repository))])
    error_message = "image_repository must be a lower-case GitHub Container Registry path such as ghcr.io/owner/bookit-demo."
  }

  validation {
    condition     = alltrue([for p in values(var.products) : contains(["bookit-deployer", "bookit-deployer-beacon"], p.deployer_role_name)])
    error_message = "deployer_role_name must be bookit-deployer or bookit-deployer-beacon."
  }

  validation {
    condition = alltrue([
      for role in distinct([for p in values(var.products) : p.deployer_role_name]) :
      length(distinct([for p in values(var.products) : p.github_repository if p.deployer_role_name == role])) == 1
    ])
    error_message = "Products that share a deployer role must share one GitHub repository."
  }
}

variable "instance_type" {
  description = "EC2 instance type for bookit-staging and bookit-production."
  type        = string
  default     = "t3.small"
}

variable "log_retention_days" {
  description = "Retention for the four CloudWatch log groups."
  type        = number
  default     = 30
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider. Set false when the account already has one."
  type        = bool
  default     = true
}
