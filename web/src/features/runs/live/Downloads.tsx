import { useEffect, useRef, useId } from 'react';
import { Button } from '../../../components/Button.js';
import { HeaderIcon } from './HeaderIcon.js';

/** Native disclosure: no mutation or download starts until an operator chooses a script. */
export function LiveDownloads({ ordinal, onScript }: { ordinal: number | null; onScript(): void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const descriptionId = useId();
  const label = ordinal === null ? 'Saved script versions' : `Script for revision ${ordinal}`;
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current) ref.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- <details> is a native disclosure; Escape closes it like a menu.
    <details
      className="live-downloads"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && ref.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary role="button" className="btn btn-secondary live-icon-action" aria-label="Download" title="Download">
        <HeaderIcon kind="download" />
      </summary>
      <div className="live-download-menu" role="group" aria-label="Run downloads">
        <Button
          variant="text"
          aria-label={label}
          aria-describedby={descriptionId}
          onClick={() => {
            if (ref.current) ref.current.open = false;
            ref.current?.querySelector('summary')?.focus();
            onScript();
          }}
        >
          <span>{label}</span>
          <small id={descriptionId}>Standalone JavaScript, runs with plain k6</small>
        </Button>
      </div>
    </details>
  );
}
