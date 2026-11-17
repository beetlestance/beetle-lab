import type { ApiClientFailure, InputRecord, ProtectedDependencies } from '@beetle/contracts/api';
import { errorMessage } from '../../app/api.js';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import type { useDeletion } from './useDeletion.js';

type Deletion = ReturnType<typeof useDeletion>;

/**
 * Overlay / Delete input (and / In use). Open while the frozen intent awaits
 * confirmation, is in flight, or was definitively refused. Unknown and accepted
 * outcomes stay on the status panel, which retains their identity.
 */
export function DeletionDialog({ deletion, record }: { deletion: Deletion; record: InputRecord | undefined }) {
  const { phase, failure } = deletion;
  if (phase !== 'confirm' && phase !== 'pending' && phase !== 'rejected') return null;
  const copy = dialogCopy(deletion, record?.name ?? 'this input');
  return (
    <Dialog
      role="alertdialog"
      title={copy.title}
      dismissible={phase !== 'pending'}
      onClose={deletion.discard}
      description={copy.description}
      actions={<DeletionActions deletion={deletion} />}
    >
      {phase === 'pending' && (
        <p role="status" className="muted">
          Submitting deletion…
        </p>
      )}
      {failure && <DeletionRefusal failure={failure} />}
    </Dialog>
  );
}

function dialogCopy(deletion: Deletion, name: string) {
  if (deletion.failure?.protocol?.code === 'protected_dependency')
    return { title: `${name} is in use`, description: undefined };
  return {
    title: `Delete ${name}?`,
    description: (
      <p>
        Delete this input at version {deletion.intent?.body.expectedVersion}? Suites that pin it in a saved revision
        keep it from being deleted.
      </p>
    ),
  };
}

function DeletionActions({ deletion }: { deletion: Deletion }) {
  if (deletion.phase === 'rejected')
    return (
      <>
        <Button onClick={deletion.discard}>Clear rejected deletion</Button>
        <Button variant="text" onClick={() => void deletion.submit()}>
          Replay identical deletion
        </Button>
      </>
    );
  const pending = deletion.phase === 'pending';
  return (
    <>
      <Button disabled={pending} onClick={deletion.discard}>
        Cancel deletion
      </Button>
      <Button variant="danger" loading={pending} loadingLabel="Deleting…" onClick={() => void deletion.submit()}>
        Confirm deletion
      </Button>
    </>
  );
}

export function DeletionRefusal({ failure, unknown = false }: { failure: ApiClientFailure; unknown?: boolean }) {
  const code = failure.protocol?.code;
  const dependencies = failure.protocol?.dependencies;
  return (
    <Banner tone="danger" title={errorMessage(failure)}>
      {code === 'protected_dependency' && (
        <>
          <p>Retained references protect this input from deletion.</p>
          {dependencies ? <DependencyList dependencies={dependencies} /> : <p>It is used by saved suite revisions.</p>}
        </>
      )}
      {code === 'conflict' && (
        <p>The version or deletion intent conflicts. Refresh current status before deciding what to do.</p>
      )}
      {unknown && <p>The request outcome is unknown. Its original identity and version are retained.</p>}
    </Banner>
  );
}

/** Names the first blockers by suite and revision; the rest are counted from `total`. */
export function DependencyList({ dependencies }: { dependencies: ProtectedDependencies }) {
  const suites = new Map<string, { name: string; ordinals: number[]; current: boolean }>();
  for (const item of dependencies.items) {
    const entry = suites.get(item.suiteId) ?? { name: item.suiteName, ordinals: [], current: false };
    entry.ordinals.push(item.ordinal);
    entry.current ||= item.current;
    suites.set(item.suiteId, entry);
  }
  const more = dependencies.total - dependencies.items.length;
  return (
    <>
      <ul className="input-dependencies" aria-label="Used by">
        {[...suites.entries()].map(([id, entry]) => (
          <li key={id}>
            <strong>{entry.name}</strong> {revisionText(entry.ordinals)}
            {entry.current && <span className="input-dependency-current"> · current revision</span>}
          </li>
        ))}
      </ul>
      {more > 0 && <p>…and {more} more saved revisions.</p>}
    </>
  );
}

function revisionText(ordinals: number[]): string {
  const sorted = [...ordinals].sort((a, b) => a - b);
  if (sorted.length === 1) return `Revision ${sorted[0]}`;
  return `Revisions ${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)}`;
}
