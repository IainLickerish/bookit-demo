import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="card card-centred fallback-card" data-testid="not-found">
      <header className="page-header">
        <h1>Page not found</h1>
      </header>
      <p>
        <Link href="/" prefetch={false} className="button-secondary" data-testid="not-found-home">
          Go to the start page
        </Link>
      </p>
    </section>
  );
}
