import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Run, RunPinReceipt } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { useToast } from '../../../components/Toast.js';
import { shortId } from '../../run-results/format.js';
import { useWrite } from './useWrite.js';

/**
 * Pin and unpin from the receipt only: no optimistic badge, because retention
 * depends on it. The receipt's state shows until the re-read Run agrees.
 */
export function usePin(run: Run) {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const { organizationId, workspaceId } = run.scope;
  const write = useWrite(`${organizationId}/${workspaceId}/${run.id}/pin`);
  const [receipt, setReceipt] = useState<RunPinReceipt | null>(null);
  const shown = receipt && receipt.pinned !== (run.pinned ?? false) ? receipt.pinned : (run.pinned ?? false);
  useEffect(() => {
    if (receipt && receipt.pinned === (run.pinned ?? false)) setReceipt(null);
  }, [receipt, run.pinned]);
  function toggle() {
    const body = { scope: run.scope, requestId: crypto.randomUUID() };
    const params = { organizationId, workspaceId, runId: run.id };
    const pin = !shown;
    write.start(
      (signal) => (pin ? api.pinRun({ params, body, signal }) : api.unpinRun({ params, body, signal })),
      (value) => {
        setReceipt(value);
        toast.show(
          value.pinned
            ? `Run ${shortId(run.id)} is pinned. Retention will not remove it.`
            : `Run ${shortId(run.id)} is unpinned`,
        );
        void client.invalidateQueries({ queryKey: queryKeys.run(organizationId, workspaceId, run.id), exact: true });
        void client.invalidateQueries({ queryKey: [...queryKeys.runs(organizationId, workspaceId), 'page'] });
      },
      (failure) => {
        // A refused pin re-reads the run so the state shown is the server's.
        if (!failure.unknown) {
          void client.invalidateQueries({ queryKey: queryKeys.run(organizationId, workspaceId, run.id), exact: true });
          void client.invalidateQueries({ queryKey: [...queryKeys.runs(organizationId, workspaceId), 'page'] });
        }
      },
    );
  }
  const reason = write.error?.failure.protocol?.reason;
  return { pinned: shown, toggle, write, reason };
}
