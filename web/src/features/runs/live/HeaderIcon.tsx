/** The live header action glyphs; button names carry their meaning. */
export function HeaderIcon({ kind }: { kind: 'compare' | 'download' }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'compare' ? (
        <path d="M4 20V10m5 10V4m5 16v-8m5 8V7" />
      ) : (
        <path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" />
      )}
    </svg>
  );
}
