import { useLayoutEffect, useMemo, useState } from 'react';
import type { ExportJob } from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';
import { Button, buttonClass } from '../../components/Button.js';
import type { ButtonSize, ButtonVariant } from '../../components/Button.js';
import { readVerifiedDownload } from './script-bytes.js';
interface Owner {
  active: boolean;
  controller: AbortController | null;
  url: string | null;
}
type Phase = 'idle' | 'reading' | 'cancelling' | 'ready' | 'cancelled' | 'error';
interface View {
  owner: Owner;
  phase: Phase;
  error: string | null;
}

/** A new publication or session retires the old control and its save URL. */
export function VerifiedExportDownload({
  job,
  label = 'Download script',
  variant = 'primary',
  size = 'md',
}: {
  job: ExportJob;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  if (job.state !== 'ready' || !job.artifact) return null;
  return <DownloadControl job={job} label={label} variant={variant} size={size} />;
}
function DownloadControl({
  job,
  label,
  variant,
  size,
}: {
  job: ExportJob;
  label: string;
  variant: ButtonVariant;
  size: ButtonSize;
}) {
  const api = useApi();
  const identity = JSON.stringify([job.scope.organizationId, job.scope.workspaceId, job.id, job.state, job.artifact]);
  const owner = useMemo<Owner>(() => ({ active: true, controller: null, url: null }), [api, identity]);
  const download = useDownload(job, owner);
  const pending = download.phase === 'reading' || download.phase === 'cancelling';
  return (
    <span className="export-verified-download">
      <Button variant={variant} size={size} disabled={pending} onClick={() => void download.start()}>
        {pending ? 'Checking download…' : label}
      </Button>
      {pending && (
        <Button variant="text" size="sm" disabled={download.phase === 'cancelling'} onClick={download.cancel}>
          Cancel download
        </Button>
      )}
      {download.phase === 'ready' && owner.url && (
        <a className={buttonClass('text', size)} href={owner.url} download="suite.js">
          Save checked script
        </a>
      )}
      <DownloadMessage phase={download.phase} error={download.error} />
    </span>
  );
}
let held: { owner: Owner; release(): void } | null = null;
/** At most one checked save URL survives across export rows/dialogs. */
function releaseHeld(owner?: Owner) {
  if (held && (!owner || held.owner === owner)) {
    const previous = held;
    held = null;
    previous.release();
  }
}
function retain(owner: Owner, url: string, clear: () => void) {
  releaseHeld();
  owner.url = url;
  held = {
    owner,
    release: () => {
      URL.revokeObjectURL(url);
      owner.url = null;
      if (owner.active) clear();
    },
  };
}
function live(owner: Owner, controller: AbortController) {
  return owner.active && !controller.signal.aborted;
}
function offerSave(url: string): boolean {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'suite.js';
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
    return true;
  } catch {
    return false;
  } finally {
    anchor.remove();
  }
}
function useDownload(job: ExportJob, owner: Owner) {
  const [saved, setSaved] = useState<View>({ owner, phase: 'idle', error: null });
  useLayoutEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
      owner.controller?.abort();
      releaseHeld(owner);
    };
  }, [owner]);
  const update = (phase: Phase, error: string | null = null) => setSaved({ owner, phase, error });
  async function start() {
    if (!owner.active || owner.controller) return;
    const controller = new AbortController();
    owner.controller = controller;
    releaseHeld();
    update('reading');
    try {
      const bytes = await readVerifiedDownload(job, controller.signal);
      if (!live(owner, controller)) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript;charset=utf-8' }));
      retain(owner, url, () => update('idle'));
      const requested = offerSave(url);
      if (live(owner, controller))
        update('ready', requested ? null : 'Your browser did not start saving. Use Save checked script.');
    } catch (error) {
      if (live(owner, controller)) update('error', downloadFailure(error));
    } finally {
      owner.controller = null;
      if (owner.active && controller.signal.aborted) update('cancelled');
    }
  }
  function cancel() {
    if (owner.controller) {
      owner.controller.abort();
      update('cancelling');
    }
  }
  const view = saved.owner === owner ? saved : { phase: 'idle' as const, error: null };
  return { ...view, start, cancel };
}

function DownloadMessage({ phase, error }: { phase: Phase; error: string | null }) {
  if (error)
    return (
      <span role="alert" className="field-error">
        {error}
      </span>
    );
  const messages: Record<Phase, string | null> = {
    idle: null,
    error: null,
    ready: 'Size and SHA-256 checked; save requested. Your browser handles saving.',
    reading: 'Checking published size and SHA-256…',
    cancelling: 'Cancelling download; waiting for cleanup…',
    cancelled: 'Download cancelled.',
  };
  const text = messages[phase];
  return text ? <span role="status">{text}</span> : null;
}

function downloadFailure(error: unknown): string {
  return error instanceof Error ? error.message : 'The script could not be verified.';
}
