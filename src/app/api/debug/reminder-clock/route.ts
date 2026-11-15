import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getClock, reminderEvalClockEnabled, setReminderEvalClock } from '@/lib/clock';
import { publicBaseUrl } from '@/lib/runtime-identity';
import { currentUser } from '@/server/request-context';
import { reminderCheckStatus } from '@/server/reminders/worker';

export const dynamic = 'force-dynamic';
const input = z.strictObject({ now: z.iso.datetime().nullable() });
const headers = { 'Cache-Control': 'no-store' };

async function denied() {
  if (!reminderEvalClockEnabled()) return NextResponse.json({}, { status: 404, headers });
  const user = await currentUser();
  if (!user || user.role !== 'admin') return NextResponse.json({}, { status: 403, headers });
  return null;
}
function snapshot() {
  return NextResponse.json({ now: getClock().now().toISOString(), ...reminderCheckStatus() }, { headers });
}

/** A test fixture only: production builds cannot read or alter this clock. */
export async function GET() {
  return (await denied()) ?? snapshot();
}

export async function POST(request: Request) {
  const refusal = await denied();
  if (refusal) return refusal;
  if (request.headers.get('origin') !== publicBaseUrl().origin) {
    return NextResponse.json({}, { status: 403, headers });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({}, { status: 400, headers });
  const instant = parsed.data.now === null ? null : new Date(parsed.data.now);
  if (instant !== null && instant < getClock().now()) return NextResponse.json({}, { status: 400, headers });
  const checks = reminderCheckStatus();
  // Advance between checks, so the next sequence is exactly the first check at the new time.
  if (checks.started !== checks.completed) return NextResponse.json({}, { status: 409, headers });
  setReminderEvalClock(instant);
  return snapshot();
}
