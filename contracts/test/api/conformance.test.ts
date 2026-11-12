import { describe, expect, expectTypeOf, it } from 'vitest';
import { apiMessageSchemas, apiOperations, apiSchemas, validateApi } from '../../src/api/index.js';
import type { PatchWorkspaceSettingsRequest, RetentionPolicy, Workspace } from '../../src/api/index.js';
import { fixture, vectors } from './fixtures.js';

describe('fixed namespace/settings JSON conformance vectors', async () => {
  for (const vector of await vectors()) {
    it(`${vector.valid ? 'accepts' : 'rejects'} ${vector.path}`, async () => {
      const input = await fixture(vector.path);
      const original = structuredClone(input);
      const result = validateApi(vector.schema, input);
      expect(result.ok).toBe(vector.valid);
      expect(input).toEqual(original);
      if (result.ok) expect(result.value).toBe(input);
      else expect(result.issues.length).toBeGreaterThan(0);
    });
  }
});

it('preserves discriminants, null inheritance and useful schema-derived leaf types', () => {
  expectTypeOf<Workspace['scope']['kind']>().toEqualTypeOf<'organization'>();
  expectTypeOf<Workspace['rootFolderId']>().toEqualTypeOf<string>();
  expectTypeOf<Extract<RetentionPolicy, { mode: 'manual' }>>().toEqualTypeOf<{ mode: 'manual' }>();
  expectTypeOf<PatchWorkspaceSettingsRequest['patch']['runDefaults']>().extract<null>().toEqualTypeOf<null>();
});

it('freezes the complete unique schema closure, public references and operation descriptors', () => {
  const pending: unknown[] = [apiSchemas, apiMessageSchemas, apiOperations];
  const ids = apiSchemas.map(schema => schema.$id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.filter(id => id.includes('/runner/'))).toEqual(['https://beetle-lab.dev/contracts/runner/v1/common']);
  while (pending.length) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') continue;
    expect(Object.isFrozen(value)).toBe(true);
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') expect(ids).toContain(String(child).split('#')[0]);
      pending.push(child);
    }
  }
  expect(Reflect.set(apiMessageSchemas.Workspace, '$ref', 'https://synthetic.invalid')).toBe(false);
  expect(Reflect.set(apiOperations, '0', {})).toBe(false);
});

it('provides parameter/query schemas for every route and validates each UUID parameter', async () => {
  const valid = (await vectors()).filter(vector => vector.valid);
  const uuid = '00000000-0000-4000-8000-000000000001';
  for (const operation of apiOperations) {
    expect(apiMessageSchemas).toHaveProperty(operation.response);
    expect(apiMessageSchemas).toHaveProperty(operation.error);
    if ('request' in operation) expect(apiMessageSchemas).toHaveProperty(operation.request);
    if ('query' in operation) {
      const vector = valid.find(vector => vector.schema === operation.query);
      if (!vector) throw new Error(`Missing query fixture: ${operation.query}`);
      expect(validateApi(operation.query, await fixture(vector.path)).ok).toBe(true);
    }
    const names = [...operation.path.matchAll(/\{([A-Za-z]+)\}/g)].map(match => match[1] ?? '');
    if (!('params' in operation)) { expect(names).toHaveLength(0); continue; }
    const params = Object.fromEntries(names.map(name => [name, uuid]));
    expect(validateApi(operation.params, params).ok).toBe(true);
    for (const name of names) {
      for (const invalid of ['', '../escape', '%2e%2e', 'not-uuid']) {
        expect(validateApi(operation.params, { ...params, [name]: invalid }).ok).toBe(false);
      }
    }
  }
});

it('bounds lists, previews and safe error details', async () => {
  const preview = await fixture('valid/retention-preview.json') as { candidates: unknown[]; protectedExclusions: unknown[] };
  preview.candidates = Array.from({ length: 101 }, () => preview.candidates[0]);
  expect(validateApi('RetentionPreview', preview).ok).toBe(false);
  const page = await fixture('valid/workspace-page.json') as { items: unknown[] };
  page.items = Array.from({ length: 101 }, () => page.items[0]);
  expect(validateApi('WorkspacePage', page).ok).toBe(false);
  const error = await fixture('valid/safe-error.json') as { fields: unknown[] };
  error.fields = Array.from({ length: 17 }, () => ({ path: '/name', code: 'type' }));
  expect(validateApi('ApiError', error).ok).toBe(false);
});

it('returns copied immutable structural errors without unsafe values or AJV internals', async () => {
  const result = validateApi('Workspace', await fixture('invalid/unknown-secret-field.json'));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('invalid fixture accepted');
  const snapshot = structuredClone(result.issues);
  expect(result.issues.length).toBeLessThanOrEqual(16);
  expect(Object.isFrozen(result.issues)).toBe(true);
  expect(result.issues.every(Object.isFrozen)).toBe(true);
  expect(JSON.stringify(result.issues)).not.toMatch(/canary|secret|params|message|schemaPath/);
  validateApi('Workspace', {});
  expect(result.issues).toEqual(snapshot);
});

it('rejects non-JSON numeric settings without normalization', async () => {
  const input = await fixture('valid/workspace.json') as { version: unknown };
  for (const version of [NaN, Infinity, -1, 0.5, true, '1']) {
    input.version = version;
    expect(validateApi('Workspace', input).ok).toBe(false);
    expect(Object.is(input.version, version)).toBe(true);
  }
});

it('keeps V19/V20/V21 semantic comparisons with the owning consumer', async () => {
  const folder = await fixture('valid/folder.json') as { id: string; parentFolderId: string; scope: { organizationId: string } };
  folder.scope.organizationId = '00000000-0000-4000-8000-000000000099';
  folder.parentFolderId = folder.id;
  // Structurally valid wrong owners and cycles require scoped transactional repository checks.
  expect(validateApi('Folder', folder).ok).toBe(true);
  const apply = await fixture('valid/retention-apply-request.json') as { expectedVersion: number };
  apply.expectedVersion = 99;
  expect(validateApi('RetentionApplyRequest', apply).ok).toBe(true);
});
