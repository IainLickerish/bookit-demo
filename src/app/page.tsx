import { redirect } from 'next/navigation';
import { currentUser } from '@/server/request-context';
import { PageHeader } from './page-header';

export default async function HomePage() {
  const user = await currentUser();
  if (!user) {
    redirect('/auth/sign-in');
  }
  if (user.role === 'patient') {
    redirect('/bookings');
  }
  return (
    <section>
      <PageHeader title="Clinic administration" />
      <div className="card">
        <p data-testid="admin-home">You are signed in as the clinic admin.</p>
      </div>
    </section>
  );
}
