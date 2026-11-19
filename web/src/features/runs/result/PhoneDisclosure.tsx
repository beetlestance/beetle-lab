import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

const phoneQuery = '(max-width: 759px)';
/** One responsive composition; no simultaneous hidden desktop/phone read owners. */
export function useResultPhone() {
  const [phone, setPhone] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(phoneQuery).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(phoneQuery);
    const change = () => setPhone(media.matches);
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return phone;
}

/** Collapsed phone sections defer their readers; direct hashes explicitly open them. */
export function PhoneDisclosure({
  id,
  title,
  description,
  children,
  hashId,
  expanded = false,
  className = '',
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  hashId?: string;
  expanded?: boolean;
  className?: string;
}) {
  const { hash } = useLocation();
  const [open, setOpen] = useState(() => matchesHash(hash, id, hashId));
  const [visited, setVisited] = useState(open || expanded);
  useEffect(() => {
    if (open || expanded) setVisited(true);
  }, [open, expanded]);
  useEffect(() => {
    if (matchesHash(hash, id, hashId)) setOpen(true);
    const changed = () => {
      if (matchesHash(window.location.hash, id, hashId)) setOpen(true);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [hash, id, hashId]);
  return (
    <details
      id={id}
      className={`result-phone-section ${className}`}
      open={expanded || open}
      onToggle={(event) => {
        if (!expanded) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span>
          {title}
          <small>{description}</small>
        </span>
        <span aria-hidden="true">›</span>
      </summary>
      {(open || expanded || visited) && <div className="result-phone-content">{children}</div>}
    </details>
  );
}

function matchesHash(hash: string, id: string, alias?: string): boolean {
  return hash === `#${id}` || (alias !== undefined && hash === `#${alias}`);
}
