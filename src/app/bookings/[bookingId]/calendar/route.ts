import type { NextRequest } from 'next/server';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { SESSION_COOKIE } from '@/server/auth/session';
import { calendarResponse } from '@/server/calendar/http';
import { requestLogger } from '@/server/request-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  const { bookingId } = await params;
  return calendarResponse(
    { db: getDatabase(), clock: getClock(), log: await requestLogger() },
    request.cookies.get(SESSION_COOKIE)?.value,
    bookingId,
  );
}
