#!/usr/bin/env bash
# Produces `terraform show -json` of a plan for review without any AWS account (owner rule, M0-34a): a throwaway copy
# of the configuration gets dummy keys and skips every AWS lookup, and `terraform plan` runs in a container with no
# network, so no request can reach AWS. Usage: infra/aws/tests/offline-plan.sh <output-dir> [extra plan arguments]
set -euo pipefail

out="${1:?Usage: offline-plan.sh <output-dir> [extra plan arguments]}"
shift
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
terraform_bin="$(command -v terraform)" || { echo "terraform is not installed" >&2; exit 1; }
image="node:24.22.1-bookworm-slim"

mkdir -p "$out"
out="$(cd "$out" && pwd)"
work="$out/workspace"
mkdir -p "$work/infra/aws" "$work/infra/caddy" "$work/tenants"
cp "$repo"/infra/aws/*.tf "$repo/infra/aws/.terraform.lock.hcl" "$work/infra/aws/"
cp -r "$repo/infra/aws/host" "$work/infra/aws/"
cp "$repo/infra/caddy/Caddyfile" "$work/infra/caddy/"
cp "$repo"/tenants/*.json "$work/tenants/"

cat > "$work/infra/aws/offline_override.tf" <<'EOF'
# Offline review only. These are not credentials; with no network no request can be sent.
provider "aws" {
  access_key                  = "offline-review-only"
  secret_key                  = "offline-review-only"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
  # The account guard needs the caller's account, which an offline run never requests. The real configuration keeps it.
  allowed_account_ids = null
}
EOF

# Provider download only (registry.terraform.io); init contacts no AWS endpoint.
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
"$terraform_bin" -chdir="$work/infra/aws" init -backend=false -input=false -no-color > "$out/init.log"

run_offline() {
  # Rootless Docker maps the container's root user to the invoking user, so written files stay owned by them.
  docker run --rm --network none \
    -e HOME=/tmp -e TF_IN_AUTOMATION=1 -e CHECKPOINT_DISABLE=1 \
    -v "$terraform_bin:/usr/local/bin/terraform:ro" \
    -v "$TF_PLUGIN_CACHE_DIR:$TF_PLUGIN_CACHE_DIR:ro" \
    -v "$work:/work" -w /work/infra/aws "$image" terraform "$@"
}

run_offline plan -input=false -no-color -refresh=false -lock=false -out=/work/review.tfplan \
  -var aws_account_id=123456789012 \
  -var demo_domain=demo.bookit.test \
  -var budget_monthly_usd=25 \
  -var budget_alert_email=owner@example.test "$@" > "$out/plan.log"
run_offline show -json /work/review.tfplan > "$out/plan.json"
echo "Offline plan written to $out/plan.json (network: none)."
