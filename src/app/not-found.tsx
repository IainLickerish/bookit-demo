import Link from 'next/link';

export default function NotFound() {
  return (
    <section data-testid="not-found">
      <h1>Page not found</h1>
      <p>
        <Link href="/" prefetch={false} className="underline">
          Go to the start page
        </Link>
      </p>
    </section>
  );
}
