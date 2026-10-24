import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getDatabase } from '@/db/client';
import { currentUser } from '@/server/request-context';
import { loadClinicSettings } from '@/server/settings';
import { signOut } from './auth/actions';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'BookIt',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [settings, user] = await Promise.all([loadClinicSettings(getDatabase()), currentUser()]);
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" prefetch={false} className="font-semibold" data-testid="clinic-name">
              {settings.clinicName}
            </Link>
            {user ? (
              <nav aria-label="Main" className="flex items-center gap-4 text-sm">
                {user.role === 'patient' ? (
                  <>
                    <Link href="/slots" prefetch={false} data-testid="nav-book">
                      Book
                    </Link>
                    <Link href="/bookings" prefetch={false} data-testid="nav-my-bookings">
                      My bookings
                    </Link>
                  </>
                ) : null}
                <form action={signOut}>
                  <button type="submit" className="underline" data-testid="sign-out">
                    Sign out
                  </button>
                </form>
              </nav>
            ) : null}
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
