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
  const shell = user?.role === 'admin' ? 'site-shell site-shell-wide' : 'site-shell';
  return (
    <html lang="en-GB">
      <body>
        <header className="site-header">
          <div
            className={`${shell} flex flex-col items-start py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4`}
          >
            <Link href="/" prefetch={false} className="clinic-name" data-testid="clinic-name">
              {settings.clinicName}
            </Link>
            {user ? (
              <nav aria-label="Main" className="-ml-3 flex flex-wrap items-center sm:ml-0">
                {user.role === 'patient' ? (
                  <>
                    <Link href="/slots" prefetch={false} className="nav-link" data-testid="nav-book">
                      Book
                    </Link>
                    <Link href="/bookings" prefetch={false} className="nav-link" data-testid="nav-my-bookings">
                      My bookings
                    </Link>
                  </>
                ) : (
                  <Link href="/admin" prefetch={false} className="nav-link" data-testid="nav-admin">
                    Clinic bookings
                  </Link>
                )}
                <form action={signOut}>
                  <button type="submit" className="nav-link" data-testid="sign-out">
                    Sign out
                  </button>
                </form>
              </nav>
            ) : null}
          </div>
        </header>
        <main className={`${shell} pt-8 pb-12 sm:pt-12`}>{children}</main>
      </body>
    </html>
  );
}
