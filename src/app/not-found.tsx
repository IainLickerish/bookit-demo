import Link from 'next/link';
import { PageHeading } from './page-heading';

export default function NotFound() {
  return (
    <section className="page-shell" data-testid="not-found">
      <div className="card" data-testid="fallback-card">
        <PageHeading title="Page not found" />
        <p className="page-actions">
          <Link href="/" prefetch={false} className="underline" data-testid="start-page-link">
            Go to the start page
          </Link>
        </p>
      </div>
    </section>
  );
}
