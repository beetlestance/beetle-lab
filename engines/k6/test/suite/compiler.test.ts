import { describe, expect, it } from 'vitest';
import { compileSuite } from '../../compiler/suite/index.js';
import { validateAndCompileSuite, validateCompileInput, validateSuiteConfig, sha256 } from '../../compiler/suite/validation.js';
import { compiled, dependencies, fixture, input } from './fixtures.js';
describe('pure suite compiler', () => {
  it('composes load plans and every method, assertion and template into immutable IR', () => {
    const value = compiled();
    expect(value.loadPlan.options.scenarios.main?.executor).toBe('per-vu-iterations');
    expect(value.requests.map(request => request.method)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    expect(value.requests[0]?.assertions.map(assertion => assertion.kind)).toEqual([
      'statusEq', 'statusFamily', 'bodyContains', 'headerExists', 'headerEquals', 'headerContains',
      'jsonExists', 'jsonEquals', 'jsonContains', 'jsonCompare',
    ]);
    expect(value.requests[0]?.assertions[6]).toMatchObject({ segments: ['users', 0, 'id'], required: true });
    expect(value.requests[0]).toMatchObject({ assertionFailureClass: 'assertion', transportFailureClass: 'transport' });
    expect(value.target).toBe('https://synthetic.invalid/api');
    expect(value.requests[0]?.path.safety).toBe('relative-path');
    expect(value.requests[0]?.headers[0]?.value.safety).toBe('no-crlf');
    expect(value.readiness).toMatchObject({ upperBoundMs: 340, exhaustion: 'preparation-failed', method: 'GET' });
    expect(Object.isFrozen(value.requests[0]?.path.tokens)).toBe(true);
    expect(value.identity.reproducibility).toBe('pinned');
  });
  it('is deterministic and isolates caller mutation and validation snapshots', () => {
    const config = fixture(); const deps = dependencies();
    const validated = validateSuiteConfig(config); const validatedDeps = validateCompileInput(deps);
    expect(validated.ok && validatedDeps.ok).toBe(true);
    if (!validated.ok || !validatedDeps.ok) return;
    config.requests[0]!.path = '/changed'; deps.engine.version = 'changed';
    const first = compileSuite(validated.value, { input: validatedDeps.value, digest: sha256 });
    const second = compileSuite(validated.value, { input: validatedDeps.value, digest: sha256 });
    expect(first).toEqual(second);
    expect(first.ok && first.value.requests[0]?.path.tokens[0]).toEqual({ kind: 'literal', value: '/users/' });
    expect(first.ok && first.value.identity.engine.version).toBe('0.57.0');
  });
  it('accepts explicit override, changes identity and validates stored and overridden target', () => {
    const base = compiled(); const deps = { ...dependencies(), targetOverride: 'http://override.invalid:8080/prefix' };
    const override = compiled(fixture(), deps);
    expect(override.target).toBe(deps.targetOverride);
    expect(override.identity.digest).not.toBe(base.identity.digest);
    expect(compiled(fixture(), { ...dependencies(), engine: { ...dependencies().engine, version: 'new' } }).identity.digest).not.toBe(base.identity.digest);
    const config = fixture(); config.target = 'file:///tmp/no';
    expect(validateAndCompileSuite(config, deps).ok).toBe(false);
  });
  it('records only opaque secret references and marks unversioned identity unknown', () => {
    const config = fixture(); delete config.secrets[0]!.version;
    const value = compiled(config);
    expect(value.identity.reproducibility).toBe('unknown');
    expect(value.identity.secrets).toEqual(config.secrets);
    expect(JSON.stringify(value)).not.toContain('SUPER_SECRET_CANARY');
    const malicious = { ...fixture(), secrets: [{ ...fixture().secrets[0], value: 'SUPER_SECRET_CANARY' }] };
    const result = validateAndCompileSuite(malicious, dependencies());
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('SUPER_SECRET_CANARY');
  });
  it('preserves distinct text and JSON body input semantics and pinned references', () => {
    const text = input('prefix {{data.users.user}}'); const json = input('{"name":"{{data.users.user}}"}', 2);
    const config = fixture();
    config.requests[1]!.body = { kind: 'input', format: 'text', input: text.ref };
    config.requests[2]!.body = { kind: 'input', format: 'json', input: json.ref };
    const value = compiled(config, dependencies([text, json]));
    expect(value.requests[1]?.body).toMatchObject({ kind: 'input', format: 'text', value: { context: 'text' } });
    expect(value.requests[2]?.body).toMatchObject({ kind: 'input', format: 'json', value: { kind: 'object' } });
    expect(value.identity.inputs).toEqual([text.ref, json.ref]);
    const wrong = input('this is raw text', 3); config.requests[2]!.body = { kind: 'input', format: 'json', input: wrong.ref };
    expect(validateAndCompileSuite(config, dependencies([text, wrong])).ok).toBe(false);
  });
  it.each(['lt', 'lte', 'gt', 'gte'] as const)('compiles JSON comparison %s', operator => {
    const config = fixture(); config.requests[0]!.assertions = [{ id: 'compare', kind: 'jsonCompare', required: true, path: '$', operator, value: 0 }];
    expect(compiled(config).requests[0]?.assertions[0]).toMatchObject({ operator, segments: [] });
  });
  it('rejects digest exceptions and non-SHA encodings at the pure boundary', () => {
    const config = validateSuiteConfig(fixture()); const deps = validateCompileInput(dependencies());
    if (!config.ok || !deps.ok) throw new Error('invalid fixture');
    for (const digest of [() => 'invalid', () => 'A'.repeat(64), () => { throw new Error('secret'); }]) {
      expect(compileSuite(config.value, { input: deps.value, digest })).toEqual({ ok: false, issues: [{ path: '', code: 'digest' }] });
    }
  });
});
