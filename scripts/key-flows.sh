#!/usr/bin/env bash
# The owner's key flows run against fresh Acme and Beacon copies with a shared fixed demo clock.
# Needs Docker and Playwright's Chromium. The evals themselves only drive these running copies.
set -euo pipefail
cd "$(dirname "$0")/.."

now="${EVAL_NOW:-2026-10-20T07:00:00.000Z}"
acme_port="${BOOKIT_PORT:-4101}"
beacon_port="${BOOKIT_BEACON_PORT:-4201}"
work="$(mktemp -d)"

clinic_env() {
  local tenant="$1"
  export BOOKIT_TENANT="$tenant" BOOKIT_PRODUCT="${tenant^^}" BOOKIT_ENV=local
  export BOOKIT_CREDENTIALS_DIR="$work/$tenant"
  if [[ "$tenant" == acme ]]; then
    export BOOKIT_PORT="$acme_port" BOOKIT_MAIL_PORT="$((acme_port + 1))" \
      BOOKIT_MAIL_FROM=noreply@acmephysio.test
  else
    export BOOKIT_PORT="$beacon_port" BOOKIT_MAIL_PORT="$((beacon_port + 1))" \
      BOOKIT_MAIL_FROM=noreply@beacondental.test
  fi
  export BOOKIT_PUBLIC_URL="http://127.0.0.1:$BOOKIT_PORT"
}
compose() {
  docker compose -p "bookit-key-flows-$BOOKIT_TENANT" -f compose.yml -f compose.key-flows.yml "$@"
}
stop() {
  for tenant in acme beacon; do
    clinic_env "$tenant"
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  done
  rm -rf "$work"
}
trap stop EXIT

# Made-up credentials for these copies only. They are never printed.
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
export BOOKIT_CLOCK_DIR="$work/clock" BOOKIT_ALLOW_TEST_CLOCK=true \
  GIT_COMMIT="$commit" BOOKIT_LOCAL_IMAGE="bookit-demo:key-flows"
for tenant in acme beacon; do
  clinic_env "$tenant"
  if [[ "$tenant" == acme ]]; then
    build_flag=--build
  else
    build_flag=--no-build
  fi
  if ! compose up "$build_flag" --detach --wait; then
    compose logs --no-color --tail 100
    exit 1
  fi
done

EVAL_BASE_URL="http://127.0.0.1:$acme_port" EVAL_MAIL_URL="http://127.0.0.1:$((acme_port + 1))" \
  EVAL_BEACON_BASE_URL="http://127.0.0.1:$beacon_port" EVAL_BEACON_MAIL_URL="http://127.0.0.1:$((beacon_port + 1))" \
  EVAL_CLOCK_FILE="$work/clock/clock.json" EVAL_PASSWORD="$password" EVAL_NOW="$now" \
  bun x playwright test -c evals "$@"
