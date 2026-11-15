'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card card-centred fallback-card" role="alert" data-testid="error-page">
      <header className="page-header">
        <h1>Something went wrong</h1>
      </header>
      <p className="alert">Please try again. If it keeps happening, contact the clinic.</p>
      <button data-testid="error-retry" type="button" className="button" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
