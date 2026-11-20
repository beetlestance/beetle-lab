import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button } from '../../components/Button.js';
import { useToast } from '../../components/Toast.js';
import { ConfirmDeletion } from '../namespace-deletion/ConfirmDeletion.js';
import '../namespace-deletion/deletion.css';
import { useOrganizationEditor } from './index.js';

/**
 * Rename and retire on Settings / Organization, the only place either lives now that the
 * header menu is the organization list. Both send the version read here, so a stale page
 * is refused by Beetle.
 */
export function ManageOrganization({ organizationId }: { organizationId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const editor = useOrganizationEditor();
  const [retiring, setRetiring] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.organization(organizationId),
    queryFn: ({ signal }) => readResult(api.getOrganization({ params: { organizationId }, signal })),
  });
  useEffect(
    () => () => {
      const queryKey = queryKeys.organization(organizationId);
      void client.cancelQueries({ queryKey, exact: true });
    },
    [client, organizationId],
  );
  const org = query.data;
  return (
    <>
      <section className="retire-panel organization-identity" aria-labelledby="organization-identity">
        <div>
          <h2 id="organization-identity">Name and address</h2>
          <p>{org ? `${org.name} · /${org.slug}` : 'Reading the organization…'}</p>
          {query.isError && <p className="retire-note">The organization could not be read, so it cannot be renamed.</p>}
        </div>
        <Button disabled={!org || editor.busy} onClick={() => org && editor.rename(org)}>
          Rename…
        </Button>
      </section>
      <section className="retire-panel" aria-labelledby="retire-organization">
        <div>
          <h2 id="retire-organization">Retire {org?.name ?? 'this organization'}</h2>
          <p>
            Removes the organization from the menu and search. Refused while it has active workspaces, so retire those
            first. Its history and stored files are kept, and their storage is not freed. This cannot be undone; the
            address becomes free to reuse.
          </p>
        </div>
        <Button variant="danger" disabled={!org} onClick={() => setRetiring(true)}>
          Retire organization…
        </Button>
        {retiring && org && (
          <ConfirmDeletion
            target={{ kind: 'organization', entity: org }}
            mode="retire"
            onClose={() => setRetiring(false)}
            onDone={() => {
              toast.show(`${org.name} is retired.`);
              client.removeQueries({ queryKey: queryKeys.organization(organizationId) });
              void client.invalidateQueries({ queryKey: queryKeys.organizations });
              void navigate(routes.organizations, { replace: true });
            }}
          />
        )}
      </section>
    </>
  );
}
