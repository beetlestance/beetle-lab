import { expect, it, vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas } from '@beetle/contracts/api';
import { history } from '../retention/selection-fixture.js';
import { pin, pinCommand, pinnedAt, runIds } from '../storage/run-pin-fixtures.js';
import { scope, storageFixture, uuid } from '../storage/fixture.js';
import { createApiServer } from '../../src/adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../../src/adapters/inbound/http/schema-compilers.js';
import { registerRunRoutes } from '../../src/adapters/inbound/http/runs/index.js';
import { protectHistorical } from '../../src/bootstrap/historical.js';
import type { RunPinStore } from '../../src/ports/runs.js';
const storage = storageFixture();

it('renders backup-time pin state read-only and refuses every pin write in history', async () => {
  const f = history(2); const [pinned, plain] = runIds(f.db); pin(f, 'pinRun', pinned!, uuid(9400));
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const installation = f.settings.chain(scope).installation; f.db.close();
  const archive = await storage.open(path, { readOnly: true, runtime: null, runs: f.config, installation });
  try {
    expect(await archive.runs.getRun({ scope, id: pinned! })).toMatchObject({ pinned: true, pinnedAt });
    expect(await archive.runs.getRun({ scope, id: plain! })).toMatchObject({ pinned: false });
    const page = await archive.runs.listRuns({ scope, limit: 10, pinned: true });
    expect(page.items.map(run => run.id)).toEqual([pinned]);
    await expect(archive.runs.pin(pinCommand('unpinRun', pinned!, uuid(9401)))).rejects.toMatchObject({ code: 'read_only' });
    await expect(archive.runs.pin(pinCommand('pinRun', plain!, uuid(9402)))).rejects.toMatchObject({ code: 'read_only' });
    expect(await archive.runs.getRun({ scope, id: pinned! })).toMatchObject({ pinned: true, pinnedAt });
  } finally { await storage.close(archive); }
});

it('exposes no historical HTTP pin or unpin write path', async () => {
  const server = createApiServer(); configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
  protectHistorical(server);
  const pinStore = vi.fn<RunPinStore['pin']>();
  registerRunRoutes(server, {
    store: { execute: vi.fn(), cancel: vi.fn(), setNote: vi.fn(), pin: pinStore }, reader: { getRun: vi.fn(), listRuns: vi.fn() },
    newId: () => uuid(1), now: () => pinnedAt, digest: () => 'a'.repeat(64), authorize: async () => undefined,
  });
  try {
    const base = `/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/runs/${uuid(70)}`;
    for (const action of ['pin', 'unpin']) {
      const response = await server.inject({ method: 'POST', url: `${base}/${action}`, payload: { scope, requestId: uuid(9403) } });
      expect(response.statusCode).toBe(403); expect(response.json()).toMatchObject({ code: 'forbidden' });
    }
    expect(pinStore).not.toHaveBeenCalled();
  } finally { await server.close(); }
});
