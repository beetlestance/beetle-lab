import { describe, expect, it } from 'vitest';
import { createEngineCatalog, CatalogError, MAX_INSTALLED_ENGINES } from '../../src/catalog/index.js';
import type { EngineRegistration } from '../../src/catalog/index.js';
import { configDigest } from '../../src/journal/index.js';
import { offer, registration } from './fixtures.js';

function invalid(input: unknown, reason: string, action: (input: never) => unknown): void {
  try { action(input as never); throw new Error('expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(CatalogError);
    expect(error).toMatchObject({ reason, message: `Engine catalog ${reason}` });
    expect(String(error)).not.toContain('secret-canary');
  }
}
describe('installed engine catalogue', () => {
  it('preflights genuine k6 structure while leaving semantic validation to the admitted engine', () => {
    const catalog = createEngineCatalog([registration()]); const source = offer();
    const found = catalog.preflight(source);
    expect(found.validation.configDigest).toBe(configDigest(source.config));
    expect(found.engine.approved).toMatchObject({ minimum: { stagingBytes: 0 }, capabilities: ['http'] });
    expect(found.engine.approved.controls).toEqual(['cpu', 'memory', 'pids', 'timeout', 'output']);
    source.config = { ...source.config, target: 'not-a-URL' };
    expect(catalog.preflight(source).offer.config.target).toBe('not-a-URL');
    expect(catalog.resolve(found.offer, found.validation)).toBe(found.engine);
  });
  it('copies and freezes private JSON without freezing caller objects', () => {
    const source = registration(); const job = offer(); const catalog = createEngineCatalog([source]);
    const found = catalog.preflight(job);
    source.manifest.capabilities.push('secret-canary'); source.manifest.entrypoint.arguments.push('secret-canary');
    job.config.target = 'secret-canary'; job.inputs.length = 0;
    expect(found.offer.config.target).toBe('https://synthetic.invalid');
    expect(found.offer.inputs).toHaveLength(1);
    expect(found.engine.manifest.capabilities).toEqual(['http']);
    for (const value of [catalog, catalog.engines, found, found.offer.config, found.offer.inputs,
      found.engine.profile.maximumBudget, found.engine.approved.controls, found.validation]) expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false); expect(Object.isFrozen(job.config)).toBe(false);
    expect(() => { found.engine.manifest.capabilities.push('bad'); }).toThrow();
  });
  it('rejects malformed envelopes and unapproved selectors with fixed errors', () => {
    const catalog = createEngineCatalog([registration()]);
    for (const value of [null, {}, { ...offer(), unknown: 'secret-canary' }, { ...offer(), budget: {} }]) {
      invalid(value, 'invalid_offer', input => catalog.preflight(input));
    }
    for (const engine of [{ ...offer().engine, id: 'K6' }, { ...offer().engine, configVersion: 2 },
      { ...offer().engine, imageDigest: `sha256:${'b'.repeat(64)}` }]) {
      invalid({ ...offer(), engine }, 'unapproved_engine', input => catalog.preflight(input));
    }
    invalid({ ...offer(), requiredCapabilities: ['secret-canary'] }, 'unapproved_engine', input => catalog.preflight(input));
  });
  it('strictly rejects missing and unknown k6 config fields, without coercion or defaults', () => {
    const catalog = createEngineCatalog([registration()]);
    for (const config of [{}, { ...offer().config, unknown: 'secret-canary' }, { ...offer().config, version: '1' }]) {
      invalid({ ...offer(), config }, 'invalid_config', input => catalog.preflight(input));
    }
  });
  it('bounds offer serialization and rejects accessors, non-JSON, cycles and excessive depth', () => {
    const catalog = createEngineCatalog([registration()]); let calls = 0;
    const cycle: { next?: unknown } = {}; cycle.next = cycle;
    let deep: unknown = {}; for (let n = 0; n < 70; n++) deep = { next: deep };
    for (const config of [cycle, deep, new Date(), { target: Infinity }, { target: 'x'.repeat(1_048_576) },
      { get target() { calls++; return 'secret-canary'; } }]) {
      invalid({ ...offer(), config }, 'invalid_offer', input => catalog.preflight(input));
    }
    expect(calls).toBe(0);
  });
  it('delegates actual offered budgets and safe profile policy to prepareRuntime', () => {
    const catalog = createEngineCatalog([registration()]);
    for (const budget of [{ ...offer().budget, cpuMillis: 999 }, { ...offer().budget, pids: 129 }]) {
      invalid({ ...offer(), budget }, 'unapproved_engine', input => catalog.preflight(input));
    }
  });
  it('rejects a required hard output quota even when the installed manifest advertises it', () => {
    const installed = registration(); installed.manifest.capabilities.push('hard-output-quota');
    const catalog = createEngineCatalog([installed]);
    const ordinary = catalog.preflight(offer(installed));
    expect(ordinary.engine.approved.capabilities).toContain('hard-output-quota');
    const requiring = { ...offer(installed), requiredCapabilities: ['http', 'hard-output-quota'] };
    invalid(requiring, 'unapproved_engine', input => catalog.preflight(input));
    invalid(requiring, 'identity', input => catalog.resolve(input, ordinary.validation));
  });
  it('requires exact complete persisted validation identity and revalidates recovered config', () => {
    const catalog = createEngineCatalog([registration()]); const found = catalog.preflight(offer());
    for (const [key, value] of Object.entries(found.validation)) {
      invalid({ ...found.validation, [key]: typeof value === 'number' ? value + 1 : `${value}x` }, 'identity',
        input => catalog.resolve(found.offer, input));
      const missing = { ...found.validation }; delete missing[key as keyof typeof missing];
      invalid(missing, 'identity', input => catalog.resolve(found.offer, input));
    }
    invalid({ ...found.validation, extra: 'secret-canary' }, 'identity', input => catalog.resolve(found.offer, input));
    invalid(null, 'identity', input => catalog.resolve(found.offer, input));
    const changed = { ...offer(), config: { ...offer().config, target: 'changed' } };
    invalid(changed, 'identity', input => catalog.resolve(input, found.validation));
    const original = registration(); const updated = { ...original, validation: { ...original.validation, catalogVersion: 2 } };
    invalid(found.offer, 'identity', input => createEngineCatalog([updated]).resolve(input, found.validation));
  });
  it('rejects forged schema callbacks before reading their fields', () => {
    let calls = 0;
    const configSchema = { get schemaId() { calls++; throw new Error('secret-canary'); },
      get schemaDigest() { calls++; throw new Error('secret-canary'); }, validate() { calls++; return true; } };
    invalid([{ ...registration(), configSchema }], 'invalid_registration', createEngineCatalog);
    invalid([{ ...registration(), configSchema: { ...registration().configSchema } }], 'invalid_registration', createEngineCatalog);
    expect(calls).toBe(0);
    const source = registration(); Object.defineProperty(source, 'manifest', { get() { calls++; return {}; } });
    invalid([source], 'invalid_registration', createEngineCatalog); expect(calls).toBe(0);
  });
  it('rejects invalid registration identities, versions and schema binding', () => {
    const mutations: ((r: EngineRegistration) => unknown)[] = [
      r => ({ ...r, configVersion: 0 }), r => ({ ...r, configVersion: Number.MAX_SAFE_INTEGER + 1 }),
      r => ({ ...r, validation: { ...r.validation, catalogVersion: 0 } }),
      r => ({ ...r, validation: { ...r.validation, manifestId: '' } }),
      r => ({ ...r, validation: { ...r.validation, profileId: 'x'.repeat(129) } }),
      r => ({ ...r, validation: { ...r.validation, schemaDigest: 'a'.repeat(64) } }),
      r => ({ ...r, manifest: { ...r.manifest, schemas: { ...r.manifest.schemas, config: 'https://wrong.invalid' } } }),
    ];
    for (const mutate of mutations) invalid([mutate(registration())], 'invalid_registration', createEngineCatalog);
  });
  it('rejects profile/image/entrypoint/network/default/minimum/maximum and required-control mismatches', () => {
    const mutations: ((r: EngineRegistration) => void)[] = [
      r => { r.manifest.defaultBudget.cpuMillis = 999; }, r => { r.manifest.minimumBudget.pids = 129; },
      r => { r.manifest.defaultBudget.pids = 129; }, r => { r.manifest.supportedControls = ['cpu', 'memory', 'pids']; },
      r => { Object.assign(r.profile, { user: '0:0' }); }, r => { Object.assign(r.profile, { stagingRoot: '/proc/staged' }); },
      r => { Object.assign(r.profile, { imageDigest: `sha256:${'b'.repeat(64)}` }); },
      r => { Object.assign(r.profile, { entrypoint: { executable: 'other', arguments: [] } }); },
      r => { Object.assign(r.profile, { network: { profile: 'none', name: 'none' } }); },
      r => { Object.assign(r.profile.effectiveImage, { defaultRuntime: '/'  }); },
    ];
    for (const mutate of mutations) { const value = registration(); mutate(value); invalid([value], 'invalid_registration', createEngineCatalog); }
  });
  it('rejects duplicate identities, ambiguous selectors and mixed installation policies', () => {
    const first = registration();
    invalid([first, registration()], 'invalid_registration', createEngineCatalog);
    const other = registration(); const ambiguous = { ...other, validation: { ...other.validation, profileId: 'other' } };
    invalid([first, ambiguous], 'invalid_registration', createEngineCatalog);
    for (const change of [{ installationId: '00000000-0000-4000-8000-000000000020' },
      { stagingRoot: '/var/lib/beetle/other' }, { user: '10002:10002' }]) {
      const other = registration(); const second = { ...other, configVersion: 2, validation: { ...other.validation, profileId: 'other' } };
      Object.assign(second.profile, change); invalid([first, second], 'invalid_registration', createEngineCatalog);
    }
    const sameIdentity = { ...registration(), configVersion: 2 };
    invalid([first, sameIdentity], 'invalid_registration', createEngineCatalog);
  });
  it('bounds registration snapshots and rejects accessors without leaking their payloads', () => {
    let calls = 0;
    const first = registration();
    const manifest = { ...first.manifest, description: 'secret-canary'.repeat(6000) };
    invalid([{ ...first, manifest }], 'invalid_registration', createEngineCatalog);
    const profile = { ...first.profile, get stagingRoot() { calls++; return '/secret-canary'; } };
    invalid([{ ...first, profile }], 'invalid_registration', createEngineCatalog);
    const entries = [first]; Object.defineProperty(entries, '0', { get() { calls++; return first; } });
    invalid(entries, 'invalid_registration', createEngineCatalog);
    invalid([{ ...first, validation: null }], 'invalid_registration', createEngineCatalog);
    expect(calls).toBe(0);
  });
  it('accepts exactly 32 bounded distinct installations and rejects zero or 33', () => {
    const values = Array.from({ length: MAX_INSTALLED_ENGINES }, (_, n) => ({ ...registration(), configVersion: n + 1,
      validation: { ...registration().validation, profileId: `profile-${n}` } }));
    const catalog = createEngineCatalog(values); expect(catalog.engines).toHaveLength(32);
    expect(catalog.preflight({ ...offer(values[31]!), engine: { ...offer().engine, configVersion: 32 } }).engine.configVersion).toBe(32);
    for (const input of [[], [...values, registration()], null, new Array(2)]) invalid(input, 'invalid_registration', createEngineCatalog);
  });
});
