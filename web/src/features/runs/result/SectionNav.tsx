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
export function ResultSectionNav({ onSelect }: { onSelect(section: Section): void }) {
  const { hash } = useLocation();
  const [selected, setSelected] = useState<Section>(() => sectionFromHash(hash) ?? 'summary');
  useEffect(() => {
    setSelected(sectionFromHash(hash) ?? 'summary');
    const changed = () => setSelected(sectionFromHash(window.location.hash) ?? 'summary');
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [hash]);
  return (
    <nav className="result-nav" aria-label="Result sections">
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`#result-${id}`}
          aria-current={selected === id ? 'location' : undefined}
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
