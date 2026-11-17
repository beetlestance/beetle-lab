import type { ReactNode } from 'react';
import './primitives.css';

export type BannerTone = 'neutral' | 'info' | 'warning' | 'danger' | 'history';

/**
 * Full-width notice with optional title and actions. `history` is the read-only
 * restored-backup banner. Danger banners announce as alerts, others as status
 * unless `live` is false (for static explanations rendered on load).
 */
export function Banner({
  tone = 'neutral',
  title,
  children,
  actions,
  live = true,
  className,
}: {
  tone?: BannerTone | undefined;
  title?: ReactNode | undefined;
  children?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  live?: boolean | undefined;
  className?: string | undefined;
}) {
  const role = live ? (tone === 'danger' ? 'alert' : 'status') : undefined;
  return (
    <div role={role} className={['banner', `banner-${tone}`, className].filter(Boolean).join(' ')}>
      <div className="banner-body">
        {title && <p className="banner-title">{title}</p>}
        {children && <div className="banner-text">{children}</div>}
      </div>
      {actions && <div className="banner-actions">{actions}</div>}
    </div>
  );
}
