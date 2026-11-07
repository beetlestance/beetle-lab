import { expect, it, vi } from 'vitest';
import { getNamespace, listNamespaces } from '../../src/application/namespaces/index.js';
import type { NamespaceEntity } from '../../src/ports/namespaces.js';
import type { NamespaceReader } from '../../src/ports/namespace-reader.js';
import { organization, root, scope, workspace, uuid } from './fixtures.js';

function reader(value: NamespaceEntity = workspace): NamespaceReader {
  return { get: vi.fn(async () => value), list: vi.fn(async () => ({ items: [value], nextCursor: null })) };
}

it('checks exact requested identity/scope and returns an isolated frozen snapshot', async () => {
  const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  const value = { ...workspace, id, scope: { ...workspace.scope, organizationId: id } };
  const result = await getNamespace({ kind: 'workspace', id: id.toUpperCase(),
    scope: { kind: 'organization', organizationId: id.toUpperCase() } }, reader(value));
  value.name = 'Changed after reply';
  expect(result.name).toBe('Project'); expect(Object.isFrozen(result)).toBe(true);
  await expect(getNamespace({ kind: 'workspace', id: uuid(99), scope: workspace.scope }, reader())).rejects.toMatchObject({ code: 'not_found' });
  await expect(getNamespace({ kind: 'workspace', id: workspace.id,
    scope: { kind: 'organization', organizationId: uuid(99) } }, reader())).rejects.toMatchObject({ code: 'not_found' });
});

it('keeps schema-valid URN identity distinct from bare UUID', async () => {
  const bare = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  const value = { ...organization, id: `urn:uuid:${bare}` };
  expect((await getNamespace({ kind: 'organization', id: value.id.toUpperCase(),
    scope: value.scope }, reader(value))).id).toBe(value.id);
  await expect(getNamespace({ kind: 'organization', id: bare,
    scope: value.scope }, reader(value))).rejects.toMatchObject({ code: 'not_found' });
});

it('rejects wrong kind/scope before calling the repository', async () => {
  const store = reader();
  await expect(getNamespace({ kind: 'folder', id: root.id, scope: { kind: 'installation' } }, store))
    .rejects.toMatchObject({ code: 'not_found' });
  expect(store.get).not.toHaveBeenCalled();
});

it.each([
  ['organization', organization, organization.scope], ['workspace', workspace, workspace.scope], ['folder', root, scope],
] as const)('returns bounded %s pages with explicit ownership', async (kind, value, owner) => {
  const page = await listNamespaces({ kind, scope: owner, limit: 10 }, reader(value));
  expect(page).toEqual({ items: [value], nextCursor: null, scope: owner });
  expect(Object.isFrozen(page.items)).toBe(true);
});

it('rejects pages that exceed requested count, duplicate IDs or scope ownership', async () => {
  const store = reader();
  store.list = async () => ({ items: [workspace, { ...workspace }], nextCursor: null });
  await expect(listNamespaces({ kind: 'workspace', scope: workspace.scope, limit: 1 }, store)).rejects.toThrow('Invalid namespace repository response');
  await expect(listNamespaces({ kind: 'workspace', scope: workspace.scope, limit: 10 }, store)).rejects.toThrow('Invalid namespace repository response');
  store.list = async () => ({ items: [{ ...workspace, scope: { kind: 'organization', organizationId: uuid(99) } }], nextCursor: null });
  await expect(listNamespaces({ kind: 'workspace', scope: workspace.scope, limit: 10 }, store)).rejects.toMatchObject({ code: 'not_found' });
});

it('rejects malformed and accessor-bearing adapter output without reading accessors or echoing values', async () => {
  const canary = 'SYNTHETIC_REPOSITORY_CANARY';
  const getter = vi.fn(() => canary);
  const value = Object.defineProperty({ ...workspace }, 'extra', { enumerable: true, get: getter });
  await expect(getNamespace({ kind: 'workspace', id: workspace.id, scope: workspace.scope }, reader(value)))
    .rejects.toThrow('Invalid namespace repository response');
  expect(getter).not.toHaveBeenCalled();
  const store = reader(organization);
  await expect(getNamespace({ kind: 'workspace', id: workspace.id, scope: workspace.scope }, store))
    .rejects.toThrow('Invalid namespace repository response');
});
