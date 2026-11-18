import Link from 'next/link';
import { PageHeader } from './page-header';

export default function NotFound() {
  return (
    <section className="narrow-page" data-testid="not-found">
      <PageHeader title="Page not found" />
      <p className="card">
        <Link href="/" prefetch={false} className="quiet-link">
          Go to the start page
        </Link>
      </p>
    </section>
  );
}
