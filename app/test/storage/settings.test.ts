import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import { observation, requestId, scope, seed, settingsCommand, settingsFixture, storageFixture, uuid } from './fixture.js';

const fixture = storageFixture();
describe('transactional settings inheritance', () => {
  it('creates fresh settings IDs, inherits ancestors, clears null overrides and persists only actual overrides', async () => {
    const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata);
    const organizationScope = { kind: 'organization' as const, organizationId: uuid(1) };
    const org = await metadata.getSettings(organizationScope);
    const workspace = await metadata.getSettings(scope);
    expect(org.id).not.toBe(workspace.id); expect(workspace.id).not.toBe(uuid(10));
    expect(validateApi('OrganizationSettings', org).ok).toBe(true);
    expect(validateApi('WorkspaceSettings', workspace).ok).toBe(true);
    const ancestor = await metadata.settings.execute(settingsCommand(org.id, { scope: organizationScope,
      schemaVersion: 2, requestId: requestId(), expectedVersion: 1, patch: { runDefaults: { budget: { cpuMillis: 200 } } } }));
    expect(ancestor.settings).toMatchObject({ overrides: { runDefaults: { budget: { cpuMillis: 200 } } } });
    const inherited = await metadata.getSettings(scope);
    expect(inherited.effective.runDefaults.budget.cpuMillis).toEqual({ value: 200, source: organizationScope,
      allowedRange: { minimum: 1, maximum: 1000 } });
    await metadata.settings.execute(settingsCommand(workspace.id, { scope, schemaVersion: 2, requestId: requestId(), expectedVersion: 1,
      patch: { runDefaults: { budget: { cpuMillis: 300 } } } }));
    const clear = await metadata.settings.execute(settingsCommand(workspace.id, { scope, schemaVersion: 2, requestId: requestId(), expectedVersion: 2,
      patch: { runDefaults: { budget: { cpuMillis: null } } } }));
    expect(clear.settings.effective.runDefaults.budget.cpuMillis.value).toBe(200);
    await fixture.close(metadata);
    const db = new DatabaseSync(path);
    try {
      const row = db.prepare('SELECT value_json FROM settings WHERE id=?').get(workspace.id);
      expect(JSON.parse(String(row?.value_json))).toEqual({});
      expect(String(row?.value_json)).not.toContain('effective');
    } finally { db.close(); }
  });
  it('returns the original receipt including effective values after ancestor changes/restart', async () => {
    const path = fixture.path(); let metadata = await fixture.open(path); await seed(metadata);
    const target = await metadata.getSettings(scope);
    const change = settingsCommand(target.id, { scope, schemaVersion: 2, requestId: requestId(), expectedVersion: 1,
      patch: { retention: { mode: 'manual' } } });
    const initial = await metadata.settings.execute(change);
    const installation = await metadata.getSettings({ kind: 'installation' });
    await metadata.settings.execute(settingsCommand(installation.id, { scope: { kind: 'installation' },
      schemaVersion: 2, requestId: requestId(), expectedVersion: 1, patch: { runDefaults: { engineProfile: 'standard',
        budget: { cpuMillis: 400, memoryBytes: 100, pids: 10, timeoutMs: 100, outputBytes: 100 } } } }));
    expect((await metadata.getSettings(scope)).effective.runDefaults.budget.cpuMillis.value).toBe(400);
    await fixture.close(metadata); metadata = await fixture.open(path);
    expect(await metadata.settings.execute(change)).toEqual(initial);
    await expect(metadata.settings.execute(settingsCommand(target.id, { ...change.request,
      patch: { runDefaults: { budget: { cpuMillis: 500 } } } }))).rejects.toMatchObject({ code: 'conflict' });
  });
  it('checks current versions, owner identity and ancestor policy inside serial transactions', async () => {
    const metadata = await fixture.open(); await seed(metadata); await seed(metadata, 20, 21, 22);
    const installation = await metadata.getSettings({ kind: 'installation' });
    const workspace = await metadata.getSettings(scope);
    const lowerAncestor = metadata.settings.execute(settingsCommand(installation.id, { scope: { kind: 'installation' },
      schemaVersion: 2, requestId: requestId(), expectedVersion: 1, patch: { perRunCeilings: { cpuMillis: 150, memoryBytes: 1000,
        pids: 100, timeoutMs: 1000, outputBytes: 1000 } } }));
    const patchDescendant = metadata.settings.execute(settingsCommand(workspace.id, { scope, schemaVersion: 2, requestId: requestId(), expectedVersion: 1,
      patch: { runDefaults: { budget: { cpuMillis: 200 } } } }));
    const descendantsRejected = expect(patchDescendant).rejects.toMatchObject({ code: 'invalid_value' });
    await lowerAncestor; await descendantsRejected;
    expect((await metadata.getSettings(scope)).version).toBe(1);
    await metadata.settings.execute(settingsCommand(workspace.id, { scope, schemaVersion: 2, requestId: requestId(), expectedVersion: 1,
      patch: { runDefaults: { budget: { cpuMillis: 120 } } } }));
    await expect(metadata.settings.execute(settingsCommand(workspace.id, { scope, schemaVersion: 2, requestId: requestId(), expectedVersion: 1,
      patch: { retention: { mode: 'manual' } } }))).rejects.toMatchObject({ code: 'conflict' });
    const other = { ...scope, organizationId: uuid(20), workspaceId: uuid(21) };
    await expect(metadata.settings.execute(settingsCommand(workspace.id, { scope: other, schemaVersion: 2, requestId: requestId(), expectedVersion: 1,
      patch: { retention: { mode: 'manual' } } }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(metadata.getSettings({ ...scope, organizationId: uuid(20) })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('preserves the drain signal and rejects forged settings digests', async () => {
    const metadata = await fixture.open(); const installation = await metadata.getSettings({ kind: 'installation' });
    const pool = settingsFixture().chain.installation.values.pool;
    const change = settingsCommand(installation.id, { scope: { kind: 'installation' }, schemaVersion: 2, requestId: requestId(), expectedVersion: 1,
      patch: { pool: { ...pool, concurrency: 1 } } });
    await expect(metadata.settings.execute({ ...change, intentDigest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_input' });
    const result = await metadata.settings.execute(change);
    expect(result.admission).toBe('drain'); expect(result.settings.version).toBe(2);
    expect(await metadata.settings.execute(change)).toEqual(result);
  });
  it('allows unknown runtime snapshots without inventing capacity and validates fresh updates', async () => {
    const metadata = await fixture.open(undefined, { runtime: null }); await seed(metadata);
    await expect(metadata.getSettings(scope)).rejects.toMatchObject({ code: 'capacity_unavailable' });
    expect(await metadata.updateRuntime(observation())).toBeNull();
    expect((await metadata.getSettings(scope)).effective.runDefaults.budget.cpuMillis.value).toBe(100);
    const bad = settingsFixture().runtime; bad.pool.cpuMillis = Number.NaN;
    await expect(metadata.updateRuntime(observation(bad))).rejects.toMatchObject({ code: 'invalid_input' });
    const badProfiles = settingsFixture().runtime; badProfiles.supportedProfiles = ['standard', 'standard'];
    await expect(metadata.updateRuntime(observation(badProfiles))).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await metadata.getSettings(scope)).version).toBe(1);
    const reduced = settingsFixture().runtime; reduced.pool.cpuMillis = 1000;
    await metadata.updateRuntime(observation(reduced));
    await expect(metadata.getSettings(scope)).rejects.toMatchObject({ code: 'capacity_unavailable' });
    await metadata.updateRuntime(null);
    await expect(metadata.getSettings({ kind: 'installation' })).rejects.toMatchObject({ code: 'capacity_unavailable' });
  });
});
