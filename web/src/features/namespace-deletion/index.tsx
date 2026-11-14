import type { Organization, Workspace, Folder } from '@beetle/contracts/api';
import { useLocation } from 'react-router-dom';
import { useApi } from '../../app/api.js';
import { useEditor } from '../../components/Editor.js';
type Target = {kind: 'organization'; entity: Organization} | {kind: 'workspace'; entity: Workspace} | {kind: 'folder'; entity: Folder};
export function DeleteNamespace({target, refresh, disabled = false}: {target: Target; refresh: () => Promise<unknown>; disabled?: boolean}) {
  const api = useApi(); const editor = useEditor(); const {pathname} = useLocation();
  function open() {
    editor.open({title: `Delete ${target.kind}`, path: pathname,
      fields: [{name: 'confirmation', label: `Confirm deletion of ${target.entity.name}`, value: '', pattern: 'DELETE',
        help: 'Type DELETE. Only empty namespaces can be removed. Retained data and protected dependencies prevent deletion.'}],
      submit: (_values, requestId) => {
        switch (target.kind) {
          case 'organization': return api.deleteOrganization({params: {organizationId: target.entity.id},
            body: {scope: target.entity.scope, expectedVersion: target.entity.version, requestId}});
          case 'workspace': return api.deleteWorkspace({params: {organizationId: target.entity.scope.organizationId, workspaceId: target.entity.id},
            body: {scope: target.entity.scope, expectedVersion: target.entity.version, requestId}});
          case 'folder': return api.deleteFolder({params: {organizationId: target.entity.scope.organizationId, id: target.entity.id},
            body: {scope: target.entity.scope, expectedVersion: target.entity.version, requestId}});
        }
      }, refresh});
  }
  return <button disabled={disabled || editor.busy} aria-label={`Delete ${target.entity.name}`} onClick={open}>Delete</button>;
}
