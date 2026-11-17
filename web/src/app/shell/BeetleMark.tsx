/** Beetle logo from the Penpot header (22 × 22): accent shell, base bar in ink. */
export function BeetleMark() {
  return (
    <svg className="shell-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      <path d="M3 14a8 8 0 0 1 16 0Z" fill="var(--amber)" />
      <path d="M11 6.2V14" stroke="var(--bg)" strokeWidth="1.4" />
      <circle cx="7.6" cy="11" r="1.3" fill="var(--bg)" />
      <circle cx="14.4" cy="11" r="1.3" fill="var(--bg)" />
      <rect x="2" y="15.2" width="18" height="2.2" rx="1.1" fill="var(--ink)" />
    </svg>
  );
}
