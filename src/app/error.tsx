'use client';

import { PageHeader } from './page-header';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="page-narrow card" role="alert" data-testid="error-page">
      <PageHeader title="Something went wrong">
        <p>Please try again. If it keeps happening, contact the clinic.</p>
      </PageHeader>
      <button type="button" className="button" onClick={() => reset()} data-testid="retry-page">
        Try again
      </button>
    </section>
  );
}
