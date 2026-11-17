/** Decorative isometric test bench from the Overview board. Carries no data. */
export function OverviewArt() {
  const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <svg className="overview-art" viewBox="0 0 360 260" aria-hidden="true" focusable="false">
      <rect x="150" y="10" width="70" height="90" fill="var(--amber)" opacity="0.14" />
      <path d="M40 150 L180 70 L320 150 L180 230 Z" fill="var(--panel)" stroke="var(--dim)" />
      <path d="M40 150 L40 162 L180 242 L180 230 Z" fill="var(--zebra)" stroke="var(--dim)" />
      <path d="M320 150 L320 162 L180 242 L180 230 Z" fill="var(--bg)" stroke="var(--dim)" />
      <path d="M80 150 L180 92 L280 150 L180 208 Z" fill="none" stroke="var(--faint)" />
      {bars.map((index) => {
        const x = 118 + index * 9;
        const top = 96 + index * 5 - (index % 3) * 6;
        return (
          <g key={index}>
            <rect x={x} y={top} width="7" height={150 - top + index * 2} fill="var(--amber-strong)" />
            <rect x={x} y={top} width="3.5" height={150 - top + index * 2} fill="var(--amber)" />
          </g>
        );
      })}
      <path d="M20 66 L66 88 L66 140 L20 118 Z" fill="none" stroke="var(--dim)" />
      <path d="M28 82 L58 96 M28 94 L58 108 M28 106 L50 116" stroke="var(--faint)" />
      <rect x="27" y="72" width="5" height="5" fill="var(--amber)" />
      <path d="M296 104 L340 80 L340 128 L296 152 Z" fill="none" stroke="var(--dim)" />
      <path d="M302 140 L312 126 L320 130 L334 98" fill="none" stroke="var(--amber)" strokeWidth="2" />
    </svg>
  );
}
