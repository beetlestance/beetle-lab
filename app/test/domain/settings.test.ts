import { describe, expect, it } from 'vitest';
import type { InstallationPatch, ScopedOverridePatch, SettingsScope } from '@beetle/contracts/api';
import { patchSettings, prepareSettingsCommand } from '../../src/application/settings/index.js';
import { decideSettingsChange, installationDefaults, patchScopedOverrides, resolveEffectiveSettings,
  resolveRunSettings, validateInstallation, validateRetention } from '../../src/domain/settings/index.js';
import type { SettingsChain } from '../../src/domain/settings/index.js';
import { SemanticError } from '../../src/domain/namespaces/index.js';
import type { SettingsChange, SettingsEvidence, SettingsRequest, SettingsStore } from '../../src/ports/settings.js';
import { digest, scope, settingsFixture, uuid } from './fixtures.js';

function effective(chain: SettingsChain, target: SettingsScope = scope) {
  return resolveEffectiveSettings({ chain, scope: target, runtime: settingsFixture().runtime });
}
function workspacePatch(patch: ScopedOverridePatch, expectedVersion = 1): SettingsRequest {
  return { scope, schemaVersion: 2, requestId: uuid(99), expectedVersion, patch };
}
function installationPatch(patch: InstallationPatch): SettingsRequest {
  return { scope: { kind: 'installation' }, schemaVersion: 2, requestId: uuid(99), expectedVersion: 1, patch };
}

/** Synthetic transaction receipt model, with no SQL/cross-process guarantees. */
function settingsStore(initial: SettingsEvidence): { store: SettingsStore; writes: SettingsChange[] } {
  let evidence = initial;
  const receipts = new Map<string, { digest: string; change: SettingsChange }>();
  const writes: SettingsChange[] = [];
  const store: SettingsStore = {
    async execute(command) {
      const key = JSON.stringify([command.request.scope, command.request.requestId]);
      const old = receipts.get(key);
      if (old) {
        if (old.digest !== command.intentDigest) throw new SemanticError('conflict');
        return old.change;
      }
      const change = decideSettingsChange(command, evidence);
      const next = change.settings;
      if (next.scope.kind === 'workspace' && 'overrides' in next) {
        evidence = { ...evidence, chain: { ...evidence.chain,
          workspace: { ...next, scope: next.scope } } };
      }
      writes.push(change);
      receipts.set(key, { digest: command.intentDigest, change });
      return change;
    },
  };
  return { store, writes };
}

describe('one effective settings resolver', () => {
  it('resolves scoped leaves with exact provenance and ranges, without inventing another pool', () => {
    const { chain } = settingsFixture();
    chain.organization!.overrides = { runDefaults: { budget: { cpuMillis: 200 }, engineProfile: 'isolated' },
      retention: { mode: 'enabled', ageDays: 30 } };
    chain.workspace!.overrides = { runDefaults: { budget: { memoryBytes: 300 } } };
    const result = effective(chain);
    expect(result.runDefaults.budget.cpuMillis).toEqual({ value: 200,
      source: chain.organization!.scope, allowedRange: { minimum: 1, maximum: 1000 } });
    expect(result.runDefaults.budget.memoryBytes.source).toEqual(scope);
    expect(result.runDefaults.budget.pids.source).toEqual({ kind: 'installation' });
    expect(result.runDefaults.engineProfile).toEqual({ value: 'isolated',
      source: chain.organization!.scope, allowedValues: ['standard', 'isolated'] });
    expect(result.retention).toEqual({ value: { mode: 'enabled', ageDays: 30 }, source: chain.organization!.scope });
    expect(Object.keys(result).sort()).toEqual(['retention', 'runDefaults']);
  });

  it('honors all five precedence levels through the same defaults rules', () => {
    const { chain, runtime } = settingsFixture();
    chain.organization!.overrides = { runDefaults: { budget: { cpuMillis: 200 } } };
    chain.workspace!.overrides = { runDefaults: { budget: { cpuMillis: 300 } } };
    const input = { chain, runtime, scope };
    const installation = resolveEffectiveSettings({ chain: { installation: chain.installation },
      scope: { kind: 'installation' }, runtime });
    expect(installation.runDefaults.budget.cpuMillis.value).toBe(100);
    const org = resolveEffectiveSettings({ chain: { installation: chain.installation, organization: chain.organization! },
      scope: chain.organization!.scope, runtime });
    expect(org.runDefaults.budget.cpuMillis.value).toBe(200);
    expect(resolveRunSettings(input).defaults.budget.cpuMillis).toBe(300);
    const suite = resolveRunSettings({ ...input, suiteRevision: { budget: { cpuMillis: 400 } } });
    expect(suite.defaults.budget.cpuMillis).toBe(400);
    expect(suite.sources.budget.cpuMillis).toBe('suiteRevision');
    const run = resolveRunSettings({ ...input, suiteRevision: { budget: { cpuMillis: 400 }, engineProfile: 'isolated' },
      run: { budget: { cpuMillis: 500 } } });
    expect(run.defaults.budget.cpuMillis).toBe(500);
    expect(run.sources.budget.cpuMillis).toBe('run');
    expect(run.sources.engineProfile).toBe('suiteRevision');
  });

  it('rejects wrong scope ancestry instead of resolving values from another owner', () => {
    const { chain } = settingsFixture();
    chain.organization!.scope.organizationId = uuid(51);
    expect(() => effective(chain)).toThrow(expect.objectContaining({ code: 'not_found' }));
    const second = settingsFixture().chain;
    second.workspace!.scope.workspaceId = uuid(52);
    expect(() => effective(second)).toThrow(expect.objectContaining({ code: 'not_found' }));
    expect(() => effective({ installation: second.installation })).toThrow(SemanticError);
    expect(() => effective(second, { kind: 'installation' })).toThrow(SemanticError);
  });

  it('freezes accepted snapshots without freezing caller inputs or sharing nested arrays/scopes', () => {
    const { chain, runtime } = settingsFixture();
    const runOverride = { budget: { cpuMillis: 300 } };
    const accepted = resolveRunSettings({ chain, runtime, scope, run: runOverride });
    const view = effective(chain);
    runOverride.budget.cpuMillis = 900;
    chain.installation.values.runDefaults.budget.memoryBytes = 800;
    chain.installation.values.supportedProfiles.push('later');
    chain.workspace!.scope.workspaceId = uuid(80);
    expect(accepted.defaults.budget.cpuMillis).toBe(300);
    expect(accepted.defaults.budget.memoryBytes).toBe(100);
    expect(view.runDefaults.engineProfile.allowedValues).toEqual(['standard', 'isolated']);
    expect(Object.isFrozen(accepted.defaults.budget)).toBe(true);
    expect(Object.isFrozen(view.runDefaults.engineProfile.allowedValues)).toBe(true);
    expect(() => { accepted.defaults.budget.cpuMillis = 600; }).toThrow(TypeError);
  });

  it('rejects unsupported profiles and invalid ancestor values even when a run would mask them', () => {
    const { chain, runtime } = settingsFixture();
    expect(() => resolveRunSettings({ chain, runtime, scope, run: { engineProfile: 'unknown' } })).toThrow(SemanticError);
    chain.organization!.overrides = { runDefaults: { budget: { cpuMillis: 2000 } } };
    expect(() => resolveRunSettings({ chain, runtime, scope, run: { budget: { cpuMillis: 100 } } })).toThrow(SemanticError);
    chain.organization!.overrides = {};
    chain.installation.values.supportedProfiles = ['unsupported'];
    expect(() => effective(chain)).toThrow(SemanticError);
  });
});

describe('override patches and atomic settings use case', () => {
  it('preserves omissions, removes null leaves/groups, and never persists inherited effective copies', () => {
    const current = { runDefaults: { engineProfile: 'isolated', budget: { cpuMillis: 300, pids: 20 } },
      retention: { mode: 'enabled' as const, ageDays: 10 } };
    expect(patchScopedOverrides(current, { runDefaults: { budget: { cpuMillis: null } } }))
      .toEqual({ runDefaults: { engineProfile: 'isolated', budget: { pids: 20 } }, retention: current.retention });
    expect(patchScopedOverrides(current, { runDefaults: { budget: null, engineProfile: null }, retention: null })).toEqual({});
    expect(patchScopedOverrides(current, { runDefaults: null })).toEqual({ retention: current.retention });
    const { chain } = settingsFixture();
    chain.organization!.overrides = { runDefaults: { budget: { cpuMillis: 200 } } };
    chain.workspace!.overrides = patchScopedOverrides({ runDefaults: { budget: { cpuMillis: 300 } } },
      { runDefaults: { budget: { cpuMillis: null } } });
    expect(effective(chain).runDefaults.budget.cpuMillis.value).toBe(200);
    expect(chain.workspace!.overrides).toEqual({});
  });

  it('persists only overrides atomically and supports receipt replay; stale version/intent failures write nothing', async () => {
    const fixture = settingsFixture();
    const synthetic = settingsStore(fixture);
    const request = workspacePatch({ runDefaults: { budget: { cpuMillis: 300 } } });
    const input = { id: fixture.chain.workspace!.id, request, digest, store: synthetic.store };
    const change = await patchSettings(input);
    expect('overrides' in change.settings && change.settings.overrides)
      .toEqual({ runDefaults: { budget: { cpuMillis: 300 } } });
    expect(change.settings.version).toBe(2);
    expect(await patchSettings(input)).toEqual(change);
    await expect(patchSettings({ ...input, request: workspacePatch({ retention: { mode: 'manual' } }) }))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(patchSettings({ ...input, request: { ...request, requestId: uuid(98) } }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(synthetic.writes).toHaveLength(1);
  });

  it('checks settings identity and freshly supplied ancestor policy at transaction decision time', () => {
    const fixture = settingsFixture();
    const command = prepareSettingsCommand({ id: uuid(12), request: workspacePatch({ runDefaults: { budget: { cpuMillis: 500 } } }), digest });
    fixture.chain.installation.values.perRunCeilings.cpuMillis = 400;
    expect(() => decideSettingsChange(command, fixture)).toThrow(SemanticError);
    fixture.chain.installation.values.perRunCeilings.cpuMillis = 1000;
    expect(() => decideSettingsChange({ ...command, id: uuid(88) }, fixture))
      .toThrow(expect.objectContaining({ code: 'not_found' }));
    fixture.chain.workspace!.version = Number.MAX_SAFE_INTEGER;
    const overflow = { ...command, request: { ...command.request, expectedVersion: Number.MAX_SAFE_INTEGER } };
    expect(() => decideSettingsChange(overflow, fixture)).toThrow(expect.objectContaining({ code: 'conflict' }));
  });

  it('replaces complete installation groups and emits drain without touching accepted active snapshots', () => {
    const fixture = settingsFixture();
    const active = resolveRunSettings({ ...fixture, scope });
    const old = fixture.chain.installation.values;
    const pool = { ...old.pool, concurrency: 1 };
    const request = installationPatch({ pool, runDefaults: { engineProfile: 'isolated', budget: { ...old.runDefaults.budget } } });
    const change = decideSettingsChange(prepareSettingsCommand({ id: uuid(10), request, digest }), fixture);
    expect(change.admission).toBe('drain');
    expect('values' in change.settings && change.settings.values.pool).toEqual(pool);
    expect('values' in change.settings && change.settings.values.runDefaults.engineProfile).toBe('isolated');
    expect(active.defaults.engineProfile).toBe('standard');
    expect(Object.keys(change).sort()).toEqual(['admission', 'settings']);
  });
});

describe('capacity accounting and manual retention boundaries', () => {
  it('rejects unknown capability data and runtime/per-run/pool excess with no clamping', () => {
    const fixture = settingsFixture();
    expect(() => resolveRunSettings({ ...fixture, scope, runtime: null }))
      .toThrow(expect.objectContaining({ code: 'capacity_unavailable' }));
    expect(() => resolveRunSettings({ ...fixture, scope, runtime: { ...fixture.runtime, supportedProfiles: [] } }))
      .toThrow(expect.objectContaining({ code: 'capacity_unavailable' }));
    const mutations = [
      () => { fixture.chain.installation.values.pool.cpuMillis = 5000; },
      () => { fixture.chain.installation.values.perRunCeilings.memoryBytes = 3000; },
      () => { fixture.chain.installation.values.pool.pids = 50; },
      () => { fixture.chain.installation.values.runDefaults.budget.outputBytes = 2000; },
      () => { fixture.chain.installation.values.pool.storageBytes = 2500; },
    ];
    for (const mutate of mutations) {
      fixture.chain = settingsFixture().chain;
      mutate();
      expect(() => validateInstallation(fixture.chain.installation.values, fixture.runtime)).toThrow(SemanticError);
    }
  });

  it('rejects zero, fractional, nonfinite, unsafe numeric values and reserve/output arithmetic overflow', () => {
    for (const invalid of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const fixture = settingsFixture();
      fixture.chain.installation.values.runDefaults.budget.cpuMillis = invalid;
      expect(() => effective(fixture.chain)).toThrow(SemanticError);
    }
    const fixture = settingsFixture();
    fixture.runtime.pool.outputBytes = Number.MAX_SAFE_INTEGER;
    fixture.runtime.pool.storageBytes = Number.MAX_SAFE_INTEGER;
    fixture.runtime.pool.freeSpaceReserveBytes = Number.MAX_SAFE_INTEGER;
    fixture.chain.installation.values.pool.outputBytes = Number.MAX_SAFE_INTEGER;
    fixture.chain.installation.values.pool.storageBytes = Number.MAX_SAFE_INTEGER;
    fixture.chain.installation.values.pool.freeSpaceReserveBytes = 1;
    expect(() => validateInstallation(fixture.chain.installation.values, fixture.runtime)).toThrow(SemanticError);
  });

  it('defaults retention to manual and validates rules without any selection/deletion effect', async () => {
    const fixture = settingsFixture();
    const { retention, ...setup } = fixture.chain.installation.values;
    expect(retention).toEqual({ mode: 'manual' });
    expect(installationDefaults(setup).retention).toEqual({ mode: 'manual' });
    expect(() => validateRetention({ mode: 'enabled' })).toThrow(SemanticError);
    expect(() => validateRetention({ mode: 'enabled', ageDays: 365001 })).toThrow(SemanticError);
    expect(() => validateRetention({ mode: 'enabled', completedRunCount: 0 })).toThrow(SemanticError);
    const synthetic = settingsStore(fixture);
    const change = await patchSettings({ id: uuid(12), request: workspacePatch({ retention: { mode: 'manual' } }),
      digest, store: synthetic.store });
    expect(change.settings.effective.retention.value).toEqual({ mode: 'manual' });
    expect(synthetic.writes).toHaveLength(1);
    expect(Object.keys(synthetic.store)).toEqual(['execute']);
  });
});
