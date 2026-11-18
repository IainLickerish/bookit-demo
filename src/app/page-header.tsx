import type { ReactNode } from 'react';

export function PageHeader({ children }: { children: ReactNode }) {
  return (
    <header className="page-header" data-testid="page-header">
      <h1>{children}</h1>
    </header>
  );
}
