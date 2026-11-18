#!/usr/bin/env bash
# The owner's key flows (evals/), run against fresh Acme and Beacon copies with a fixed date.
# Needs Docker, and the repository's packages with Playwright's Chromium. Extra arguments go to Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."

now="${EVAL_NOW:-2026-10-20T07:00:00.000Z}"
port="${BOOKIT_PORT:-4101}"
beacon_port="${BOOKIT_BEACON_PORT:-$((port + 100))}"
work="$(mktemp -d)"
compose=(docker compose -f compose.yml -f compose.key-flows.yml)

clinic_compose() {
  local tenant="$1" clinic_port="$2" domain="$3"
  shift 3
  BOOKIT_CREDENTIALS_DIR="$work/$tenant" BOOKIT_TENANT="$tenant" BOOKIT_PRODUCT="${tenant^^}" \
    BOOKIT_MAIL_FROM="noreply@$domain" BOOKIT_PORT="$clinic_port" BOOKIT_MAIL_PORT="$((clinic_port + 1))" \
    BOOKIT_PUBLIC_URL="http://127.0.0.1:$clinic_port" "${compose[@]}" -p "bookit-key-flows-$tenant" "$@"
}

stop() {
  clinic_compose acme "$port" acmephysio.test down --volumes --remove-orphans >/dev/null 2>&1 || true
  clinic_compose beacon "$beacon_port" beacondental.test down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap stop EXIT

# Made-up credentials for this copy only. They are never printed.
mkdir -m 755 "$work/clock"
password="$(openssl rand -hex 16)"
for tenant in acme beacon; do
  mkdir -m 700 "$work/$tenant"
  openssl rand -hex 32 >"$work/$tenant/database-password"
  openssl rand -hex 32 >"$work/$tenant/postgres-password"
  EVAL_PASSWORD="$password" bun -e 'const t = await Bun.file(process.argv[1]).json();
console.log(JSON.stringify(Object.fromEntries(t.accounts.map((a) => [a.email, process.env.EVAL_PASSWORD]))));' \
    "tenants/$tenant.json" >"$work/$tenant/accounts.json"
  chmod 444 "$work/$tenant/"*
done
printf '{"now":"%s"}' "$now" >"$work/clock/clock.json"
chmod 644 "$work/clock/clock.json"

commit="$(git rev-parse HEAD)"
export BOOKIT_CLOCK_DIR="$work/clock" BOOKIT_ALLOW_TEST_CLOCK=true BOOKIT_ENV=local \
  GIT_COMMIT="$commit" BOOKIT_LOCAL_IMAGE="bookit-demo:key-flows"
if ! clinic_compose acme "$port" acmephysio.test up --build --detach --wait; then
  clinic_compose acme "$port" acmephysio.test logs --no-color --tail 100
  exit 1
fi
if ! clinic_compose beacon "$beacon_port" beacondental.test up --no-build --detach --wait; then
  clinic_compose beacon "$beacon_port" beacondental.test logs --no-color --tail 100
  exit 1
fi

EVAL_BASE_URL="http://127.0.0.1:$port" EVAL_MAIL_URL="http://127.0.0.1:$((port + 1))" \
  EVAL_BEACON_BASE_URL="http://127.0.0.1:$beacon_port" EVAL_PASSWORD="$password" EVAL_NOW="$now" \
  bun x playwright test -c evals "$@"
