import { redirect } from 'next/navigation';
import { currentUser } from '@/server/request-context';
import { PageHeading } from './page-heading';

export default async function HomePage() {
  const user = await currentUser();
  if (!user) {
    redirect('/auth/sign-in');
  }
  if (user.role === 'patient') {
    redirect('/bookings');
  }
  return (
    <section className="page-shell">
      <div className="card" data-testid="home-card">
        <PageHeading title="Clinic administration">
          <p data-testid="admin-home">You are signed in as the clinic admin.</p>
        </PageHeading>
      </div>
    </section>
  );
}
