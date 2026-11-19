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
      <body>
        <header className="site-header" data-testid="site-header">
          <div className="site-bar">
            <Link href="/" prefetch={false} className="clinic-name" data-testid="clinic-name">
              {settings.clinicName}
            </Link>
            {user ? (
              <nav aria-label="Main" className="site-nav">
                {user.role === 'patient' ? (
                  <>
                    <Link href="/slots" prefetch={false} data-testid="nav-book">
                      Book
                    </Link>
                    <Link href="/bookings" prefetch={false} data-testid="nav-my-bookings">
                      My bookings
                    </Link>
                  </>
                ) : (
                  <Link href="/admin" prefetch={false} data-testid="nav-admin">
                    Clinic bookings
                  </Link>
                )}
                <form action={signOut}>
                  <button
                    type="submit"
                    className="font-medium text-pine underline underline-offset-4 hover:text-pine-hover"
                    data-testid="sign-out"
                  >
                    Sign out
                  </button>
                </form>
              </nav>
            ) : null}
          </div>
        </header>
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
