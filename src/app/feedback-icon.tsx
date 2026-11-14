/** Decorative outline icons always accompany a written result. */
export function FeedbackIcon({ kind }: { kind: 'done' | 'attention' }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="feedback-icon"
    >
      {kind === 'done' ? (
        <>
          <circle cx="10" cy="10" r="8" />
          <path d="m6 10 3 3 5-6" />
        </>
      ) : (
        <>
          <path d="M10 2 19 18H1L10 2Z" />
          <path d="M10 8v4m0 3h.01" />
        </>
      )}
    </svg>
  );
}
