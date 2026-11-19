import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="narrow-page card" data-testid="not-found">
      <h1 className="page-heading">Page not found</h1>
      <Link href="/" prefetch={false} className="button" data-testid="not-found-start">
        Go to the start page
      </Link>
    </section>
  );
}
