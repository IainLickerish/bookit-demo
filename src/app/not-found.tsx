import Link from 'next/link';
import { PageHeader } from './page-header';

export default function NotFound() {
  return (
    <section className="page page-narrow card card-accent" data-testid="not-found">
      <PageHeader title="Page not found" />
      <Link href="/" prefetch={false} className="button">
        Go to the start page
      </Link>
    </section>
  );
}
