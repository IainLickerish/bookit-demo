import Link from 'next/link';
import { PageHeader } from './page-header';

export default function NotFound() {
  return (
    <section className="page-narrow card" data-testid="not-found">
      <PageHeader title="Page not found" />
      <p>
        <Link href="/" prefetch={false} className="button" data-testid="not-found-home">
          Go to the start page
        </Link>
      </p>
    </section>
  );
}
