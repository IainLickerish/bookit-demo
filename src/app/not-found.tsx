import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="card" data-testid="not-found">
      <header className="page-header">
        <h1>Page not found</h1>
        <p>
          <Link href="/" prefetch={false} className="text-link" data-testid="not-found-home">
            Go to the start page
          </Link>
        </p>
      </header>
    </section>
  );
}
