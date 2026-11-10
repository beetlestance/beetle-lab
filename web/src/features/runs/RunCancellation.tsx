import type { Run } from '@beetle/contracts/api';
import { useCancellation } from './useCancellation.js';

export function RunCancellation({ run }: { run: Run }) {
  const cancel = useCancellation({ organizationId: run.scope.organizationId,
    workspaceId: run.scope.workspaceId, runId: run.id });
  const terminal = ['finished', 'cancelled', 'errored'].includes(run.state);
  if (terminal) return null;
  const requested = run.cancellationRequested || cancel.accepted;
  return <section aria-label="Run cancellation">
    {requested ? <p role="status">Cancellation requested. Waiting for confirmed execution and result status.</p>
      : <button type="button" disabled={cancel.pending || cancel.unknown} onClick={() => void cancel.request()}>
        {cancel.pending ? 'Requesting cancellation…' : 'Cancel run'}</button>}
    {cancel.message && !requested && <div role="alert"><p>{cancel.message}</p>
      {cancel.unknown && <button type="button" disabled={cancel.pending} onClick={() => void cancel.request()}>Retry same cancellation</button>}
    </div>}
  </section>;
}
