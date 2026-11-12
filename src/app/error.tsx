'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card" role="alert" data-testid="error-page">
      <header className="page-header">
        <h1>Something went wrong</h1>
        <p>Please try again. If it keeps happening, contact the clinic.</p>
      </header>
      <button type="button" className="button" onClick={() => reset()} data-testid="error-retry">
        Try again
      </button>
    </section>
  );
}
