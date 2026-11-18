import Link from 'next/link';
import { PageHeader } from './page-header';

export default function NotFound() {
  return (
    <section className="card" data-testid="not-found">
      <PageHeader>Page not found</PageHeader>
      <p>
        <Link href="/" prefetch={false} className="underline">
          Go to the start page
        </Link>
      </p>
    </section>
  );
}
