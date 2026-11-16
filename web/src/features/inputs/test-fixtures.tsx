import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { InputRecord, Workspace } from '@beetle/contracts/api';
import type { ReactNode } from 'react';
import { ApiContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { ids, json, workspace } from '../../app/test-fixtures.js';
import type { testClient } from '../../app/test-fixtures.js';
import { InputInventory } from './index.js';

export { apiError, deferred, ids, json, testClient, workspace } from '../../app/test-fixtures.js';
export type { RequestRecord } from '../../app/test-fixtures.js';

export function input(overrides: Partial<InputRecord> = {}): InputRecord {
  return { id: ids.folder, scope: { kind: 'workspace', organizationId: ids.a, workspaceId: ids.workspace },
    folderId: ids.root, name: 'Synthetic dataset', sha256: 'a'.repeat(64), bytes: 64, offset: 32,
    version: 7, state: 'staging', reason: null, ...overrides };
}
export function page(items = [input()], nextCursor: string | null = null, organizationId = ids.a) {
  return json({ scope: { kind: 'workspace', organizationId, workspaceId: ids.workspace }, items, nextCursor });
}
export function receipt(body: Record<string, unknown> | undefined) {
  return json({ id: ids.folder, scope: body?.scope, requestId: body?.requestId, operation: 'delete', acceptedVersion: 8 }, 202);
}
export function mount(client: ReturnType<typeof testClient>['client'], initial: Workspace = workspace(),
  renderActions?: (record: InputRecord) => ReactNode) {
  const cache = createQueryClient();
  const view = (scope: Workspace) => <ApiContext.Provider value={client}><QueryClientProvider client={cache}>
    <InputInventory workspace={scope} {...(renderActions ? { renderActions } : {})} />
  </QueryClientProvider></ApiContext.Provider>;
  const rendered = render(view(initial));
  return { ...rendered, cache, switchScope: (scope: Workspace) => rendered.rerender(view(scope)) };
}
