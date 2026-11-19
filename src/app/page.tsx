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
    <section className="staff-page">
      <h1 className="page-heading">Clinic administration</h1>
      <p className="card max-w-[45rem]" data-testid="admin-home">
        You are signed in as the clinic admin.
      </p>
    </section>
  );
}
