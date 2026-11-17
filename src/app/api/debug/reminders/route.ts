import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { testClockAllowedByBuild } from '@/lib/build-flags';
import { getClock } from '@/lib/clock';
import { runtimeIdentity } from '@/lib/runtime-identity';
import { currentUser } from '@/server/request-context';
import { reminderDependencies } from '@/server/notifications/reminder-worker';
import { sendDueReminders } from '@/server/notifications/reminders';

const input = z.strictObject({ bookingId: z.uuid(), now: z.iso.datetime() });

/** A scoped clock fixture for browser checks, never available in production builds or environments. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!testClockAllowedByBuild() || runtimeIdentity().environment === 'production' || !process.env.BOOKIT_TEST_CLOCK) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const origin = request.headers.get('origin');
  let sameOrigin = false;
  try {
    const supplied = new URL(origin ?? '');
    sameOrigin =
      supplied.origin === origin &&
      supplied.protocol === request.nextUrl.protocol &&
      supplied.host === (request.headers.get('host') ?? request.nextUrl.host);
  } catch {
    // Missing and opaque origins cannot authorise a state-changing fixture call.
  }
  if (!sameOrigin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const now = new Date(parsed.data.now);
  const difference = now.getTime() - getClock().now().getTime();
  if (Math.abs(difference) > 366 * 86_400_000) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const processed = await sendDueReminders(
    { ...reminderDependencies(), clock: { now: () => now } },
    parsed.data.bookingId,
  );
  return NextResponse.json({ processed });
}
