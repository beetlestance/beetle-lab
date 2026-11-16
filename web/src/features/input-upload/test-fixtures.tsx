import { render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { InputRecord, InputTransferClient, Workspace } from '@beetle/contracts/api';
import { vi } from 'vitest';
import { ApiContext, InputTransferContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { ids, json, testClient, workspace } from '../../app/test-fixtures.js';
import { UploadInput } from './index.js';
import { UploadWorkflow } from './workflow.js';
import type { UploadState } from './workflow.js';

export { apiError, deferred, folder, ids, json, testClient, workspace } from '../../app/test-fixtures.js';
export type { RequestRecord } from '../../app/test-fixtures.js';
export function input(overrides: Partial<InputRecord> = {}): InputRecord {
  return { id: ids.folder, scope: { kind: 'workspace', organizationId: ids.a, workspaceId: ids.workspace },
    folderId: ids.root, name: 'Dataset', sha256: 'a'.repeat(64), bytes: 3, offset: 0,
    version: 1, state: 'staging', reason: null, ...overrides };
}
export function transfers(content = new Uint8Array([1, 2, 3])) {
  return {
    prepare: vi.fn<InputTransferClient['prepare']>(async () => ({ ok: true, value: { sha256: 'a'.repeat(64), content } })),
    append: vi.fn<InputTransferClient['append']>(async ({ record, chunk }) => ({ ok: true,
      value: { ...record, offset: record.offset + chunk.length, version: record.version + 1 } })),
    download: vi.fn<InputTransferClient['download']>(),
    close: vi.fn<InputTransferClient['close']>(),
  };
}
export function file(size = 3) { return new File([new Uint8Array(size)], 'fixture.bin'); }
export function receipt(body: Record<string, unknown> | undefined) {
  return json({ id: ids.folder, scope: input().scope, requestId: body?.requestId, operation: 'seal',
    acceptedVersion: Number(body?.expectedVersion) + 1 }, 202);
}
export function fixture(handler: Parameters<typeof testClient>[0], bytes = new Uint8Array([1, 2, 3])) {
  const api = testClient(handler);
  const transfer = transfers(bytes);
  const changed = vi.fn<(state: UploadState) => void>();
  const invalidate = vi.fn();
  const owner = new UploadWorkflow({ api: api.client, transfers: transfer, workspace: workspace(), changed, invalidate });
  return { api, transfer, owner, changed, invalidate };
}
export async function settled(owner: UploadWorkflow) { await waitFor(() => expectIdle(owner)); }
function expectIdle(owner: UploadWorkflow) { if (owner.state.busy) throw new Error('Workflow still pending'); }
export function mount(api: ReturnType<typeof testClient>['client'], initialTransfers: InputTransferClient | null = transfers()) {
  const cache = createQueryClient();
  const view = (scope: Workspace, client: InputTransferClient | null) => <ApiContext.Provider value={api}>
    <InputTransferContext.Provider value={client}><QueryClientProvider client={cache}>
      <UploadInput workspace={scope} />
    </QueryClientProvider></InputTransferContext.Provider></ApiContext.Provider>;
  const rendered = render(view(workspace(), initialTransfers));
  return { ...rendered, cache, switchScope: (scope: Workspace) => rendered.rerender(view(scope, initialTransfers)),
    switchClient: (client: InputTransferClient | null) => rendered.rerender(view(workspace(), client)) };
}
