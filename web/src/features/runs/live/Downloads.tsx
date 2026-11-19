import { useEffect, useRef, useId, useState } from 'react';
import { Button } from '../../../components/Button.js';
import { HeaderIcon } from './HeaderIcon.js';

import { provisionalDownload } from './provisional-download.js';
import type { DownloadKind, ProvisionalSnapshot } from './provisional-download.js';

export function LiveDownloads({
  ordinal,
  snapshot,
  onScript,
}: {
  ordinal: number | null;
  snapshot: ProvisionalSnapshot | null;
  onScript(): void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { save, saving, message } = useProvisionalSave(snapshot);
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
        <Button variant="text" disabled={!snapshot || saving} onClick={() => save('report')}>
          <span>Report so far</span>
          <small>{snapshot ? 'Provisional text report (.txt)' : 'Waiting for live observations'}</small>
        </Button>
        <Button variant="text" disabled={!snapshot || saving} onClick={() => save('metrics')}>
          <span>Metrics so far</span>
          <small>{snapshot ? 'Provisional chart windows (.csv)' : 'Waiting for live observations'}</small>
        </Button>
        {message && <p role="alert">{message}</p>}

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

function useProvisionalSave(snapshot: ProvisionalSnapshot | null) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  function save(kind: DownloadKind) {
    if (!snapshot || saving) return;
    setMessage('');
    setSaving(true);
    try {
      const file = provisionalDownload(kind, snapshot);
      saveFile(file);
    } catch {
      setMessage('Could not prepare the provisional download. Try again.');
    } finally {
      // Keep a single object URL per menu during the browser's download handoff.
      setTimeout(() => {
        setSaving(false);
      }, 1000);
    }
  }
  return { save, saving, message };
}

function saveFile({ filename, type, text }: ReturnType<typeof provisionalDownload>) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    // Let Chromium start the download before revoking the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
