import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness: the server process is up. It checks nothing else and changes nothing. */
export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', service: 'bookit' }, { headers: { 'Cache-Control': 'no-store' } });
}
