import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { CreateSuiteRequest, PatchSuiteRequest, Suite, Workspace } from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { TextInput } from '../../components/Fields.js';
import { SuiteFolderPicker } from './FolderPicker.js';
import { useWrite, WriteStatus } from './useWrite.js';

/** Create or patch a suite; after a create the new suite opens on its Edit tab. */
function useSuiteWrite(
  workspace: Workspace,
  suite: Suite | undefined,
  close: () => void,
  view: 'form' | 'json' = 'form',
) {
  const api = useApi();
  const client = useQueryClient();
  const navigate = useNavigate();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const created = useRef<Suite | null>(null);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: queryKeys.suites(params.organizationId, params.workspaceId) });
    await client.invalidateQueries({ queryKey: queryKeys.folders(params.organizationId, params.workspaceId) });
    if (created.current)
      void navigate(
        routes.suitePage(params.organizationId, params.workspaceId, created.current.id, { tab: 'edit', view }),
      );
    else close();
  };
  const write = useWrite<CreateSuiteRequest | PatchSuiteRequest>(async (body, signal) => {
    if (suite && 'expectedVersion' in body)
      return api.patchSuite({ params: { ...params, suiteId: suite.id }, body, signal });
    const reply = await api.createSuite({ params, body: body as CreateSuiteRequest, signal });
    if (reply.ok) created.current = reply.value;
    return reply;
  }, refresh);
  return { write, refresh };
}
/**
 * Suite details dialog. Without `suite` it creates a k6 suite in `folderId` and
 * opens it on the Edit tab; with `suite` it patches name, folder and description.
 */
export function MetadataEditor({
  workspace,
  suite,
  folderId: initialFolder,
  initialView,
  close,
}: {
  workspace: Workspace;
  suite?: Suite;
  folderId?: string;
  initialView?: 'form' | 'json';
  close: () => void;
}) {
  const [name, setName] = useState(suite?.name ?? '');
  const [description, setDescription] = useState(suite?.description ?? '');
  const [folderId, setFolderId] = useState(suite?.folderId ?? initialFolder ?? workspace.rootFolderId);
  const { write, refresh } = useSuiteWrite(workspace, suite, close, initialView);
  const text = description.trim();
  function submit() {
    const scope = {
      kind: 'workspace' as const,
      organizationId: workspace.scope.organizationId,
      workspaceId: workspace.id,
    };
    const common = { scope, requestId: crypto.randomUUID(), name: name.trim(), folderId };
    if (suite)
      void write.submit({
        ...common,
        expectedVersion: suite.version,
        description: text ? text : suite.description ? null : undefined,
      } as PatchSuiteRequest);
    else void write.submit({ ...common, ...(text ? { description: text } : {}) });
  }
  return (
    <Dialog title={suite ? 'Suite details' : 'New k6 suite'} onClose={close} dismissible={!write.pending}>
      <form
        className="suite-details"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={write.locked}>
          <legend className="sr-only">Suite details</legend>
          <TextInput
            label="Suite name"
            required
            maxLength={128}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextInput
            label="Description (optional)"
            maxLength={280}
            value={description}
            hint="One sentence on what this suite checks."
            onChange={(event) => setDescription(event.target.value)}
          />
          <SuiteFolderPicker workspace={workspace} selected={folderId} choose={setFolderId} />
        </fieldset>
        <WriteStatus write={write} refresh={refresh} />
        <div className="dialog-actions">
          <Button variant="text" disabled={write.pending} onClick={close}>
            Not now
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={write.pending}
            loadingLabel="Saving…"
            disabled={write.unknown}
          >
            {suite ? 'Save details' : 'Create suite'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
