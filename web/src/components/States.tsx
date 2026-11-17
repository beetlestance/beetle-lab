import type { ReactNode } from 'react';
import './primitives.css';

/**
 * Empty state: what this place is for and the next action. `compact` is the
 * in-panel form (for an empty table inside a page that has other content).
 */
export function EmptyState({
  title,
  children,
  actions,
  note,
  art,
  compact = false,
  headingLevel = 2,
}: {
  title: ReactNode;
  children?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  note?: ReactNode | undefined;
  /** Optional illustration, decorative only. */
  art?: ReactNode | undefined;
  compact?: boolean | undefined;
  headingLevel?: 1 | 2 | 3 | undefined;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={compact ? 'empty-state empty-state-compact' : 'empty-state'}>
      {art && <div aria-hidden="true">{art}</div>}
      <Heading>{title}</Heading>
      {children && <div className="empty-state-text">{children}</div>}
      {actions && <div className="empty-state-actions">{actions}</div>}
      {note && <p className="empty-state-note">{note}</p>}
    </section>
  );
}

/**
 * Loading placeholder. `inline` is a status line; `page`, `table` and `cards` are
 * skeletons matching the Loading boards. Always announces `label` to assistive tech.
 */
export function LoadingState({
  label = 'Loading…',
  variant = 'inline',
  rows = 5,
}: {
  label?: string | undefined;
  variant?: 'inline' | 'page' | 'table' | 'cards' | undefined;
  rows?: number | undefined;
}) {
  if (variant === 'inline')
    return (
      <p role="status" className="loading-inline">
        {label}
      </p>
    );
  return (
    <div role="status" className="skeleton" aria-busy="true">
      <span className="sr-only">{label}</span>
      {variant === 'page' && <SkeletonIntro />}
      {variant === 'cards' && <SkeletonCards count={Math.min(rows, 4)} />}
      {variant === 'table' && <SkeletonRows count={rows} />}
      {variant === 'page' && <SkeletonRows count={rows} />}
    </div>
  );
}

function SkeletonIntro() {
  return (
    <div className="skeleton" aria-hidden="true">
      <div className="skeleton-bar skeleton-title" />
      <div className="skeleton-bar" style={{ width: 'min(640px, 90%)' }} />
      <div className="skeleton-bar" style={{ width: 'min(448px, 70%)' }} />
    </div>
  );
}
function SkeletonCards({ count }: { count: number }) {
  return (
    <div className="skeleton-cards" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-card">
          <div className="skeleton-bar" style={{ width: '45%' }} />
          <div className="skeleton-bar" style={{ width: '80%', height: 22 }} />
          <div className="skeleton-bar" />
        </div>
      ))}
    </div>
  );
}
function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="skeleton" aria-hidden="true" style={{ gap: 0 }}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-row">
          <div className="skeleton-bar" style={{ flexBasis: 90 }} />
          <div className="skeleton-bar" style={{ flexBasis: 220 }} />
          <div className="skeleton-bar" style={{ flexBasis: 120 }} />
          <div className="skeleton-bar" style={{ flexBasis: 70 }} />
        </div>
      ))}
    </div>
  );
}
