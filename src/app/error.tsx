'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="narrow-page card" role="alert" data-testid="error-page">
      <header className="page-heading space-y-2">
        <h1>Something went wrong</h1>
        <p className="text-muted">Please try again. If it keeps happening, contact the clinic.</p>
      </header>
      <button type="button" className="button" onClick={() => reset()} data-testid="retry-page">
        Try again
      </button>
    </section>
  );
}
