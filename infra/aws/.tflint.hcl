config {
  call_module_type = "none"
}

plugin "terraform" {
  enabled = true
  preset  = "all"
}

plugin "aws" {
  enabled = true
  version = "0.50.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

# A root configuration applied by the owner, not a reusable module: files are named by area (network, logs, compute,
# deploy, budget) instead of a single main.tf.
rule "terraform_standard_module_structure" {
  enabled = false
}
