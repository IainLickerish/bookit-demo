'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" data-testid="error-page">
      <h1>Something went wrong</h1>
      <p className="mb-4">Please try again. If it keeps happening, contact the clinic.</p>
      <button type="button" className="button" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
