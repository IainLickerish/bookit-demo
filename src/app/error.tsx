'use client';

import { PageHeading } from './page-heading';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="page-shell" role="alert" data-testid="error-page">
      <div className="card" data-testid="fallback-card">
        <PageHeading title="Something went wrong">
          <p>Please try again. If it keeps happening, contact the clinic.</p>
        </PageHeading>
        <button type="button" className="button" data-testid="retry-page" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </section>
  );
}
