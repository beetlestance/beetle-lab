import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button } from '../../components/Button.js';
import { useToast } from '../../components/Toast.js';
import { ConfirmDeletion } from './ConfirmDeletion.js';
import './deletion.css';

/**
 * "Retire checkout-team" on Settings / Workspace. Reads the workspace once for its name
 * and version; the confirmation sends that version, so a stale page is refused by Beetle.
 */
export function RetireWorkspace({ organizationId, workspaceId }: { organizationId: string; workspaceId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const key = queryKeys.workspace(organizationId, workspaceId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readResult(api.getWorkspace({ params: { organizationId, workspaceId }, signal })),
  });
  useEffect(
    () => () => {
      const queryKey = queryKeys.workspace(organizationId, workspaceId);
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    },
    [client, organizationId, workspaceId],
  );
  const workspace = query.data;
  return (
    <section className="retire-panel" aria-labelledby="retire-workspace">
      <div>
        <h2 id="retire-workspace">Retire {workspace?.name ?? 'this workspace'}</h2>
        <p>
          Hides the workspace from lists. Its suites, run history, receipts and stored files are kept, and their storage
          is not freed. Refused while runs, exports or uploads are unfinished. This cannot be undone; the name becomes
          free to reuse.
        </p>
        {query.isError && <p className="retire-note">The workspace could not be read, so it cannot be retired here.</p>}
      </div>
      <Button variant="danger" disabled={!workspace} onClick={() => setOpen(true)}>
        Retire workspace…
      </Button>
      {open && workspace && (
        <ConfirmDeletion
          target={{ kind: 'workspace', entity: workspace }}
          onClose={() => setOpen(false)}
          onDone={() => {
            toast.show(`${workspace.name} is retired.`);
            void client.invalidateQueries({ queryKey: queryKeys.organization(organizationId) });
            void navigate(routes.organization(organizationId));
          }}
        />
      )}
    </section>
  );
}
