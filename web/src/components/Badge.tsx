import type { ReactNode } from 'react';
import './primitives.css';

export type BadgeTone = 'neutral' | 'strong' | 'amber' | 'pass' | 'fail' | 'history';

/** Pill chip for tags, counts and labels such as "Latest" or "This run". */
export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span className={['badge', tone === 'neutral' ? '' : `badge-${tone}`, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}

export type StatusTone = 'running' | 'pass' | 'fail' | 'info' | 'skipped' | 'neutral';

/** Coloured dot plus label, as in "● Running" or "● Passed". The label carries the meaning. */
export function Status({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span className={['status', tone === 'neutral' ? '' : `status-${tone}`, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
