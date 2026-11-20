import type { ReactNode } from 'react';

export function Notice({ kind, testId, children }: { kind: 'notice' | 'alert'; testId: string; children: ReactNode }) {
  const problem = kind === 'alert';
  return (
    <p role={problem ? 'alert' : 'status'} className={kind} data-testid={testId}>
      <svg
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="10" cy="10" r="8.25" />
        <path d={problem ? 'M10 6v4.5m0 3.25h.01' : 'm6.5 10 2.25 2.25 4.75-4.75'} />
      </svg>
      <span>{children}</span>
    </p>
  );
}
