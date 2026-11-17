import type { ReactNode } from 'react';

export function PageHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-heading" data-testid="page-heading">
      <h1 data-testid="page-title">{title}</h1>
      {children}
    </header>
  );
}
