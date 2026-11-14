'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card client-page" role="alert" data-testid="error-page">
      <header className="page-header">
        <h1>Something went wrong</h1>
        <p>Please try again. If it keeps happening, contact the clinic.</p>
      </header>
      <button type="button" className="button" data-testid="error-retry" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
