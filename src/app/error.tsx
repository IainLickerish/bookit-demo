'use client';

import { PageHeader } from './page-header';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card" role="alert" data-testid="error-page">
      <PageHeader>Something went wrong</PageHeader>
      <p className="mb-4">Please try again. If it keeps happening, contact the clinic.</p>
      <button type="button" className="button" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
