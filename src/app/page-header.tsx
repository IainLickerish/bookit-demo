import type { ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1 data-testid="page-title">{title}</h1>
      {children}
    </header>
  );
}
