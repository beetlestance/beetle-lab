import { afterEach, expect, it, vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas } from '@beetle/contracts/api';
import { otherId, runValue } from '../../application/runs/fixture.js';
import { fixture } from './fixture.js';
import { createApiServer } from '../../../src/adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../../../src/adapters/inbound/http/schema-compilers.js';
import { registerRunRoutes } from '../../../src/adapters/inbound/http/runs/index.js';
import { decodeRunListQuery } from '../../../src/adapters/inbound/http/page-query.js';
import { classifyMetadataError, explainMetadataError } from '../../../src/bootstrap/metadata-errors.js';
import { StorageError } from '../../../src/adapters/outbound/sqlite/index.js';
import type { ErrorCode } from '../../../src/adapters/outbound/sqlite/index.js';
import type { RunPinStore } from '../../../src/ports/runs.js';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const value = fixture(); fixtures.push(value); return value; }
afterEach(async () => { await Promise.all(fixtures.splice(0).map(value => value.close())); });

it('pins and unpins through the scoped receipt store with the server clock outside the intent', async () => {
  const f = setup(); const headers = await f.paired(); const id = runValue().id;
  for (const [action, kind, pinned] of [['pin', 'pinRun', true], ['unpin', 'unpinRun', false]] as const) {
    const body = { scope: f.body.scope, requestId: otherId };
    const response = await f.server.inject({ method: 'POST', url: `${f.base}/${id}/${action}`, headers, payload: body });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id, scope: body.scope, requestId: otherId, pinned, ...(pinned ? { pinnedAt: '2026-11-10T00:00:00.000Z' } : {}) });
    expect(f.pin.mock.calls.at(-1)![0]).toMatchObject({ kind, id, requestedAt: '2026-11-10T00:00:00.000Z', request: body });
  }
  expect(f.execute).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
});

it('refuses a mismatched scope or extra field before any store call', async () => {
  const f = setup(); const headers = await f.paired(); const id = runValue().id;
  const foreign = { ...f.body.scope, workspaceId: otherId };
  for (const payload of [{ scope: foreign, requestId: otherId }, { scope: f.body.scope, requestId: otherId, pinned: true }]) {
    const response = await f.server.inject({ method: 'POST', url: `${f.base}/${id}/pin`, headers, payload });
    expect([400, 404]).toContain(response.statusCode);
  }
  expect(f.pin).not.toHaveBeenCalled();
});

it('rejects a store receipt for another request or direction', async () => {
  const f = setup(); const headers = await f.paired(); const id = runValue().id;
  f.pin.mockImplementationOnce(async command => ({ id, scope: command.request.scope, requestId: command.request.requestId, pinned: false }));
  const response = await f.server.inject({ method: 'POST', url: `${f.base}/${id}/pin`, headers, payload: { scope: f.body.scope, requestId: otherId } });
  expect(response.statusCode).toBe(500);
});

it('maps every pin refusal to its public code and fixed reason', async () => {
  const cases: [ErrorCode, number, string, string][] = [
    ['pin_limit', 409, 'conflict', 'pin_limit'], ['run_active', 409, 'conflict', 'active'],
    ['cleanup_in_progress', 409, 'conflict', 'cleanup_in_progress'], ['run_pinned', 409, 'protected_dependency', 'pinned'],
  ];
  for (const [storage, status, code, reason] of cases) {
    const server = createApiServer({ classify: classifyMetadataError, explain: explainMetadataError });
    configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
    const pin = vi.fn<RunPinStore['pin']>(async () => { throw new StorageError(storage); });
    registerRunRoutes(server, { store: { execute: vi.fn(), cancel: vi.fn(), pin }, reader: { getRun: vi.fn(), listRuns: vi.fn() },
      newId: () => otherId, now: () => '2026-11-10T00:00:00.000Z', digest: () => 'a'.repeat(64), authorize: async () => undefined });
    try {
      const scope = runValue().scope;
      const response = await server.inject({ method: 'POST', payload: { scope, requestId: otherId },
        url: `/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/runs/${runValue().id}/pin` });
      expect(response.statusCode).toBe(status); expect(response.json()).toMatchObject({ code, reason });
    } finally { await server.close(); }
  }
  expect(explainMetadataError(new StorageError('conflict'))).toBeUndefined();
});

it('decodes only the literal pinned=true list filter', () => {
  expect(decodeRunListQuery({ limit: '10', pinned: 'true' })).toEqual({ ok: true, value: { limit: 10, pinned: true } });
  for (const pinned of ['false', '1', ''])
    expect(decodeRunListQuery({ limit: '10', pinned }).ok).toBe(false);
});
