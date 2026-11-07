// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ApiContext } from '../../app/api.js';
import { createQueryClient, queryKeys } from '../../app/queries.js';
import { EditorProvider } from '../../components/Editor.js';
import { ids, json, testClient } from '../../app/test-fixtures.js';
import { Settings } from './index.js';
import { orgScope, settings } from './test-fixtures.js';

afterEach(cleanup);
it.each(['installation', 'organization'] as const)('%s save invalidates affected descendants only', async kind => {
  const scope = kind === 'installation' ? { kind: 'installation' as const } : orgScope;
  const client = createQueryClient();
  const descendant = queryKeys.workspaceSettings(ids.a, ids.workspace);
  const foreign = queryKeys.workspaceSettings(ids.b, ids.workspace);
  client.setQueryData(descendant, settings({ kind: 'workspace', organizationId: ids.a, workspaceId: ids.workspace }));
  client.setQueryData(foreign, settings({ kind: 'workspace', organizationId: ids.b, workspaceId: ids.workspace }));
  const api = testClient(() => json(settings(scope)));
  render(<MemoryRouter><ApiContext.Provider value={api.client}><QueryClientProvider client={client}>
    <EditorProvider><Settings scope={scope} /></EditorProvider>
  </QueryClientProvider></ApiContext.Provider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit retention policy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Changes saved.');
  expect(client.getQueryState(descendant)?.isInvalidated).toBe(true);
  expect(client.getQueryState(foreign)?.isInvalidated).toBe(kind === 'installation');
  client.clear();
});
