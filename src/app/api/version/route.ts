import { NextResponse } from 'next/server';
import { buildIdentity } from '@/lib/build-flags';
import { getClock } from '@/lib/clock';
import { runtimeIdentity } from '@/lib/runtime-identity';
import { serverStartedAt, versionPayload } from '@/server/version';

export const dynamic = 'force-dynamic';

/**
 * The revision and identity this container serves (plan 12.6, F-39), which
 * SupportAgents compares with its environment record before binding QA
 * verification to a revision. Read-only: no database access, no side effects.
 */
export function GET(): NextResponse {
  const payload = versionPayload(buildIdentity(), runtimeIdentity(), serverStartedAt(getClock()));
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}
