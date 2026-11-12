#!/usr/bin/env bash
# The owner's key flows (evals/), run against a fresh copy of BookIt with the Acme test data and a fixed date, the same
# way the Software Factory runs them. CI runs this, so the key flows are also checked independently of the factory.
# Needs Docker, and the repository's packages with Playwright's Chromium. Extra arguments go to Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."

now="${EVAL_NOW:-2026-10-20T07:00:00.000Z}"
port="${BOOKIT_PORT:-4101}"
work="$(mktemp -d)"
compose=(docker compose -p bookit-key-flows -f compose.yml -f compose.key-flows.yml)
stop() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap stop EXIT

# Made-up credentials for this copy only. They are never printed.
mkdir -m 700 "$work/creds"
mkdir -m 755 "$work/clock"
password="$(openssl rand -hex 16)"
openssl rand -hex 32 >"$work/creds/database-password"
openssl rand -hex 32 >"$work/creds/postgres-password"
EVAL_PASSWORD="$password" bun -e 'const t = await Bun.file("tenants/acme.json").json();
console.log(JSON.stringify(Object.fromEntries(t.accounts.map((a) => [a.email, process.env.EVAL_PASSWORD]))));' \
  >"$work/creds/accounts.json"
chmod 444 "$work/creds/"*
printf '{"now":"%s"}' "$now" >"$work/clock/clock.json"
chmod 644 "$work/clock/clock.json"

commit="$(git rev-parse HEAD)"
export BOOKIT_CREDENTIALS_DIR="$work/creds" BOOKIT_CLOCK_DIR="$work/clock" BOOKIT_ALLOW_TEST_CLOCK=true \
  BOOKIT_TENANT=acme BOOKIT_PRODUCT=ACME BOOKIT_ENV=local BOOKIT_MAIL_FROM=noreply@acmephysio.test \
  GIT_COMMIT="$commit" BOOKIT_PORT="$port" BOOKIT_MAIL_PORT="$((port + 1))" \
  BOOKIT_PUBLIC_URL="http://127.0.0.1:$port" BOOKIT_LOCAL_IMAGE="bookit-demo:key-flows"
if ! "${compose[@]}" up --build --detach --wait; then
  "${compose[@]}" logs --no-color --tail 100
  exit 1
fi

EVAL_BASE_URL="http://127.0.0.1:$port" EVAL_MAIL_URL="http://127.0.0.1:$((port + 1))" EVAL_PASSWORD="$password" \
  EVAL_NOW="$now" bun x playwright test -c evals "$@"
