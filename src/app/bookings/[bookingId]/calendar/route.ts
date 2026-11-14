import type { NextRequest } from 'next/server';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { SESSION_COOKIE } from '@/server/auth/session';
import { calendarDownloadResponse } from '@/server/bookings/calendar-download';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  return calendarDownloadResponse(
    getDatabase(),
    getClock(),
    request.cookies.get(SESSION_COOKIE)?.value,
    (await params).bookingId,
  );
}
