import type { NextRequest } from 'next/server';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { SESSION_COOKIE } from '@/server/auth/session';
import { bookingCalendarResponse } from '@/server/bookings/calendar-http';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  return bookingCalendarResponse(
    { db: getDatabase(), clock: getClock() },
    request.cookies.get(SESSION_COOKIE)?.value,
    (await params).bookingId,
  );
}
