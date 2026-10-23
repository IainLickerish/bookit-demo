import { redirect } from 'next/navigation';
import { currentUser } from '@/server/request-context';
import { single, type SearchParams } from '../../messages';
import { signIn } from '../actions';

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  if (await currentUser()) {
    redirect('/');
  }
  const error = single((await searchParams).error);
  return (
    <section className="max-w-sm">
      <h1>Sign in</h1>
      {error === 'invalid' ? (
        <p role="alert" className="alert" data-testid="sign-in-error">
          The email address or password is not correct.
        </p>
      ) : null}
      <form action={signIn} className="space-y-4">
        <label>
          Email address
          <input name="email" type="email" autoComplete="username" required data-testid="sign-in-email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            data-testid="sign-in-password"
          />
        </label>
        <button type="submit" className="button" data-testid="sign-in-submit">
          Sign in
        </button>
      </form>
    </section>
  );
}
