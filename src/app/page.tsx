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
    <section>
      <h1>Clinic administration</h1>
      <p data-testid="admin-home">You are signed in as the clinic admin.</p>
    </section>
  );
}
