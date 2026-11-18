'use client';

import { PageHeader } from './page-header';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="narrow-page" role="alert" data-testid="error-page">
      <PageHeader title="Something went wrong" />
      <div className="card space-y-4">
        <p>Please try again. If it keeps happening, contact the clinic.</p>
        <button type="button" className="button" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </section>
  );
}
