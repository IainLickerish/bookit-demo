'use client';

import { PageHeader } from './page-header';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="page page-narrow card card-accent" role="alert" data-testid="error-page">
      <PageHeader title="Something went wrong">
        <p>Please try again. If it keeps happening, contact the clinic.</p>
      </PageHeader>
      <button type="button" className="button" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
