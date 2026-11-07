import { expect, it, vi } from 'vitest';
import type { SettingsScope } from '@beetle/contracts/api';
import { getSettings, getSettingsIdentity, patchScopedSettings } from '../../src/application/settings/index.js';
import { resolveEffectiveSettings } from '../../src/domain/settings/index.js';
import type { SettingsIdentity, SettingsReader, SettingsView } from '../../src/ports/settings-reader.js';
import type { SettingsRequest, SettingsStore } from '../../src/ports/settings.js';
import { digest, scope, settingsFixture, uuid } from '../domain/fixtures.js';

function view(): SettingsView {
  const { chain, runtime } = settingsFixture();
  return copy({ ...chain.workspace!, effective: resolveEffectiveSettings({ scope, chain, runtime }) });
}
function reader(value: unknown = view(), identity: unknown = { id: uuid(12), scope }): SettingsReader {
  return { getSettings: vi.fn(async () => value as SettingsView),
    getSettingsIdentity: vi.fn(async () => identity as SettingsIdentity) };
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

it('freezes independent scope authority before effect mutation and snapshots returned values', async () => {
  const expected = { ...scope };
  const value = view();
  const effect = reader(value);
  effect.getSettings = async supplied => {
    expect(supplied).not.toBe(expected); expect(Object.isFrozen(supplied)).toBe(true);
    Reflect.set(supplied, 'organizationId', uuid(99));
    expected.organizationId = uuid(99);
    return value;
  };
  const result = await getSettings(expected, effect);
  expect(result.scope).toEqual(scope); expect(Object.isFrozen(result.effective.runDefaults.budget)).toBe(true);
  value.effective.runDefaults.budget.cpuMillis.value = 999;
  expect(result.effective.runDefaults.budget.cpuMillis.value).toBe(100);
});

it('rejects scope substitution even when a reader tries to rewrite its effect argument', async () => {
  const foreign = view(); foreign.scope = { ...scope, organizationId: uuid(99) };
  const effect = reader(foreign);
  effect.getSettings = async supplied => { Reflect.set(supplied, 'organizationId', uuid(99)); return foreign; };
  await expect(getSettings(scope, effect)).rejects.toMatchObject({ code: 'not_found' });
});

it('allows only installation and requested ancestors across every effective source', async () => {
  for (const source of [{ ...scope, workspaceId: uuid(99) }, { kind: 'organization', organizationId: uuid(99) }] as SettingsScope[]) {
    for (const field of ['profile', 'budget', 'retention']) {
      const value = view();
      if (field === 'profile') value.effective.runDefaults.engineProfile.source = source;
      if (field === 'budget') value.effective.runDefaults.budget.timeoutMs.source = source;
      if (field === 'retention') value.effective.retention.source = source;
      await expect(getSettings(scope, reader(value))).rejects.toMatchObject({ code: 'not_found' });
    }
  }
  const value = view();
  value.effective.runDefaults.engineProfile.source = { kind: 'organization', organizationId: scope.organizationId };
  value.effective.retention.source = { ...scope };
  expect(await getSettings(scope, reader(value))).toEqual(value);
});

it('rejects malformed, oversized, non-JSON, cyclic and accessor adapter answers without invoking getters', async () => {
  const getter = vi.fn(() => uuid(12));
  const accessor = Object.defineProperty({}, 'id', { enumerable: true, get: getter });
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const value of [null, undefined, new Date(), cyclic, accessor, { ...view(), extra: 'x'.repeat(65537) },
    { ...view(), version: 0 }, { ...view(), extra: true }]) {
    const effect = reader(); effect.getSettings = async () => value as SettingsView;
    await expect(getSettings(scope, effect)).rejects.toThrow();
  }
  expect(getter).not.toHaveBeenCalled();
});

it('checks exact bounded UUID identity shape and scope without resolving effective defaults', async () => {
  const effect = reader();
  const identity = await getSettingsIdentity(scope, effect);
  expect(identity).toEqual({ id: uuid(12), scope }); expect(Object.isFrozen(identity.scope)).toBe(true);
  expect(effect.getSettings).not.toHaveBeenCalled();
  for (const invalid of [null, [], { id: 'invalid', scope }, { id: uuid(12), scope, extra: true },
    { id: uuid(12) }, { id: uuid(12), scope: { ...scope, extra: true } }, { id: 'x'.repeat(2049), scope }]) {
    await expect(getSettingsIdentity(scope, reader(undefined, invalid))).rejects.toThrow();
  }
  await expect(getSettingsIdentity(scope, reader(undefined, { id: uuid(12), scope: { ...scope, workspaceId: uuid(99) } })))
    .rejects.toMatchObject({ code: 'not_found' });
});

it('retains the entire PATCH intent before identity I/O despite mutable caller/effect attempts', async () => {
  const request: SettingsRequest = { scope: { ...scope }, requestId: uuid(50), expectedVersion: 1,
    schemaVersion: 2, patch: { retention: { mode: 'manual' } } };
  const original = copy(request);
  const effect = reader();
  effect.getSettingsIdentity = async supplied => {
    Reflect.set(supplied, 'workspaceId', uuid(99));
    request.scope = { ...scope, workspaceId: uuid(99) }; request.expectedVersion = 999;
    request.patch = { retention: null };
    return { id: uuid(12), scope: { ...scope } };
  };
  const execute = vi.fn<SettingsStore['execute']>(async command => {
    expect(command.request).toEqual(original); expect(Object.isFrozen(command.request.patch)).toBe(true);
    return { settings: view(), admission: 'unchanged' };
  });
  await patchScopedSettings({ scope, request, reader: effect, store: { execute }, digest });
  expect(execute).toHaveBeenCalledOnce(); expect(effect.getSettings).not.toHaveBeenCalled();
});

it('fails route/body scope and malformed authority before reads or writes', async () => {
  const effect = reader(); const execute = vi.fn<SettingsStore['execute']>();
  const request: SettingsRequest = { scope: { ...scope, workspaceId: uuid(99) }, requestId: uuid(50),
    schemaVersion: 2, expectedVersion: 1, patch: { retention: { mode: 'manual' } } };
  await expect(patchScopedSettings({ scope, request, reader: effect, store: { execute }, digest }))
    .rejects.toMatchObject({ code: 'not_found' });
  await expect(getSettings({ ...scope, organizationId: 'invalid' }, effect)).rejects.toThrow();
  expect(effect.getSettingsIdentity).not.toHaveBeenCalled(); expect(effect.getSettings).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it('validates mutation output scope, identity and provenance before publication', async () => {
  for (const change of ['scope', 'identity', 'provenance', 'oversize']) {
    const value = view();
    if (change === 'scope') value.scope = { ...scope, workspaceId: uuid(99) };
    if (change === 'identity') value.id = uuid(99);
    if (change === 'provenance') value.effective.retention.source = { ...scope, organizationId: uuid(99) };
    if (change === 'oversize') Object.assign(value, { extra: 'x'.repeat(65537) });
    const execute: SettingsStore['execute'] = async () => ({ settings: value, admission: 'unchanged' });
    await expect(patchScopedSettings({ scope, request: { scope, requestId: uuid(50), expectedVersion: 1,
      schemaVersion: 2, patch: { retention: { mode: 'manual' } } }, reader: reader(), store: { execute }, digest })).rejects.toThrow();
  }
});
