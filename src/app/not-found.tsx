import Link from 'next/link';
import { PageHeader } from './page-header';

export default function NotFound() {
  return (
    <section className="page-narrow" data-testid="not-found">
      <PageHeader title="Page not found" />
      <div className="card">
        <Link href="/" prefetch={false} className="tap-link">
          Go to the start page
        </Link>
      </div>
    </section>
  );
}
