import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
const sections = [
  ['summary', 'Summary'],
  ['thresholds', 'Thresholds'],
  ['endpoints', 'Endpoints'],
  ['charts', 'Charts'],
  ['target', 'Target runtime'],
  ['report', 'Report'],
  ['artifacts', 'Artifacts'],
  ['diagnostics', 'Diagnostics'],
] as const;
export type Section = (typeof sections)[number][0];
const sectionFromHash = (hash: string) => sections.find(([id]) => hash === `#result-${id}`)?.[0];
/** Native anchors retain scroll/history behavior; selection also follows hash navigation. */
export function ResultSectionNav({
  onSelect,
  archiveMissing,
  hideTarget,
}: {
  onSelect(section: Section): void;
  archiveMissing?: boolean;
  hideTarget?: boolean;
}) {
  const { hash } = useLocation();
  const [selected, setSelected] = useState<Section>(() => sectionFromHash(hash) ?? 'summary');
  useEffect(() => {
    setSelected(sectionFromHash(hash) ?? 'summary');
    const changed = () => setSelected(sectionFromHash(window.location.hash) ?? 'summary');
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [hash]);
  const available = sections.filter(([id]) => {
    if (archiveMissing && (id === 'charts' || id === 'endpoints')) return false;
    return !hideTarget || id !== 'target';
  });
  const active = available.some(([id]) => id === selected) ? selected : 'summary';
  return (
    <nav className="result-nav" aria-label="Result sections">
      {available.map(([id, label]) => (
        <a
          key={id}
          href={`#result-${id}`}
          aria-current={active === id ? 'location' : undefined}
          onClick={() => {
            setSelected(id);
            onSelect(id);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
