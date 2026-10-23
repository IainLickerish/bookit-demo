import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/server/auth/session';
import { adminReportResponse } from '@/server/admin/http';
import { adminDependencies } from '@/server/admin/context';

export async function GET(request: NextRequest): Promise<Response> {
  return adminReportResponse(
    await adminDependencies(),
    request.cookies.get(SESSION_COOKIE)?.value,
    request.nextUrl.searchParams,
    'csv',
  );
}
