import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="card client-page" data-testid="not-found">
      <header className="page-header">
        <h1>Page not found</h1>
      </header>
      <p>
        <Link href="/" prefetch={false} className="button" data-testid="not-found-start">
          Go to the start page
        </Link>
      </p>
    </section>
  );
}
