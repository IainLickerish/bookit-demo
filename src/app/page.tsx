import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/request-context';

export default async function HomePage() {
  const user = await currentUser();
  if (!user) {
    redirect('/auth/sign-in');
  }
  if (user.role === 'patient') {
    redirect('/bookings');
  }
  return (
    <section className="card" data-testid="admin-home-card">
      <header className="page-header">
        <h1>Clinic administration</h1>
        <p data-testid="admin-home">You are signed in as the clinic admin.</p>
      </header>
      <div className="action-group">
        <Link href="/admin" prefetch={false} className="button" data-testid="home-clinic-bookings">
          Clinic bookings
        </Link>
        <Link href="/admin/settings" prefetch={false} className="button-secondary" data-testid="home-clinic-settings">
          Clinic settings
        </Link>
      </div>
    </section>
  );
}
