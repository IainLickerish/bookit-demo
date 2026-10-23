import { NextResponse, type NextRequest } from 'next/server';
import { testClockAllowedByBuild } from './lib/build-flags';
import { getLogger } from './lib/logger';
import { nextRequestId, REQUEST_ID_HEADER, ROUTE_HEADER } from './lib/request-id';

export function proxy(request: NextRequest): NextResponse {
  const requestId = nextRequestId(testClockAllowedByBuild());
  const route = request.nextUrl.pathname;
  // Client-supplied values for these headers are always replaced.
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set(ROUTE_HEADER, route);
  getLogger().info({ event: 'http.request', request_id: requestId, route, method: request.method }, 'Request received');
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
