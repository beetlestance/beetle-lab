import { describe, expect, it } from 'vitest';
import type { Folder } from '@beetle/contracts/api';
import { decideNamespaceChange, mutateNamespace, prepareNamespaceCommand } from '../../src/application/namespaces/index.js';
import { foldedName, normalizedName, sameScope, SemanticError } from '../../src/domain/namespaces/index.js';
import type { NamespaceChange, NamespaceCommand, NamespaceEntity, NamespaceEvidence,
  NamespaceOperation, NamespaceStore } from '../../src/ports/namespaces.js';
import { digest, folder, organization, root, scope, uuid, workspace } from './fixtures.js';

function command(operation: NamespaceOperation): NamespaceCommand {
  return prepareNamespaceCommand(operation, digest);
}
function patchFolder(id: string, patch: { name?: string; parentFolderId?: string } = {}): NamespaceCommand {
  return command({ kind: 'patchFolder', id, request: { scope, requestId: uuid(99), expectedVersion: 1, ...patch } });
}
const evidence = (parentChain: Folder[] = [root], subtreeHeight = 0): NamespaceEvidence =>
  ({ folder: { workspace, parentChain, subtreeHeight } });

/** Synthetic receipt/index model only. This is not SQLite/concurrency/FK evidence. */
function atomicFixture(initial: NamespaceEvidence = {}): {
  store: NamespaceStore; writes: NamespaceChange[]; setEvidence: (value: NamespaceEvidence) => void;
} {
  const receipts = new Map<string, { digest: string; entity: NamespaceEntity }>();
  const siblings = new Set<string>();
  const slugs = new Set<string>();
  const writes: NamespaceChange[] = [];
  let current = initial;
  const store: NamespaceStore = {
    async execute(next) {
      const key = JSON.stringify([next.request.scope, next.request.requestId]);
      const receipt = receipts.get(key);
      if (receipt) {
        if (receipt.digest !== next.intentDigest) throw new SemanticError('conflict');
        return receipt.entity;
      }
      const change = decideNamespaceChange(next, current);
      const sibling = JSON.stringify([change.entity.scope,
        'parentFolderId' in change.entity ? change.entity.parentFolderId : null, change.foldedName]);
      if (siblings.has(sibling)) throw new SemanticError('conflict');
      if ('slug' in change.entity && slugs.has(change.entity.slug)) throw new SemanticError('conflict');
      siblings.add(sibling);
      if ('slug' in change.entity) slugs.add(change.entity.slug);
      writes.push(change);
      receipts.set(key, { digest: next.intentDigest, entity: change.entity });
      return change.entity;
    },
  };
  return { store, writes, setEvidence: value => { current = value; } };
}

describe('namespace identity and atomic commands', () => {
  it('trims and folds names without locale or host path semantics', () => {
    expect(normalizedName('  Project  ')).toBe('Project');
    expect(foldedName(' ＰROJECT ')).toBe('project');
    for (const invalid of [' ', 'x\nvalue', 'x'.repeat(129)]) expect(() => normalizedName(invalid)).toThrow(SemanticError);
    expect(normalizedName('../display only')).toBe('../display only');
  });

  it('creates a real immutable root atomically with workspace', async () => {
    const fixture = atomicFixture({ organization });
    const operation: NamespaceOperation = { kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3),
      request: { requestId: uuid(99), scope: workspace.scope, name: ' Project ' } };
    const result = await mutateNamespace({ operation, store: fixture.store, digest });
    expect(result).toEqual(workspace);
    expect(fixture.writes[0]?.rootFolder).toEqual(root);
    expect(Object.isFrozen(result.scope)).toBe(true);
    operation.request.name = 'Changed';
    expect(result.name).toBe('Project');
  });

  it('identical names in two organisations/workspaces remain isolated; wrong parents are not-found', () => {
    const first = command({ kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3),
      request: { requestId: uuid(99), scope: workspace.scope, name: 'Project' } });
    const second = command({ kind: 'createWorkspace', id: uuid(22), rootFolderId: uuid(23),
      request: { requestId: uuid(98), scope: { kind: 'organization', organizationId: uuid(21) }, name: 'Project' } });
    expect(decideNamespaceChange(first, { organization }).entity.scope).toEqual(workspace.scope);
    expect(decideNamespaceChange(second, { organization: { ...organization, id: uuid(21) } }).entity.scope)
      .toEqual({ kind: 'organization', organizationId: uuid(21) });
    expect(() => decideNamespaceChange(second, { organization })).toThrow(expect.objectContaining({ code: 'not_found' }));
    const wrong = { ...folder(4), scope: { ...scope, organizationId: uuid(21) } };
    expect(() => decideNamespaceChange(patchFolder(uuid(4), { name: 'Same' }), { ...evidence(), current: wrong }))
      .toThrow(expect.objectContaining({ code: 'not_found' }));
  });

  it('preserves workspace owner/root identity and rejects stale or unsafe versions', () => {
    const operation: NamespaceOperation = { kind: 'patchWorkspace', id: workspace.id,
      request: { scope: workspace.scope, requestId: uuid(99), expectedVersion: 1, name: 'Renamed' } };
    const result = decideNamespaceChange(command(operation), { organization, current: workspace }).entity;
    expect(result).toEqual({ ...workspace, name: 'Renamed', version: 2 });
    for (const version of [2, Number.MAX_SAFE_INTEGER]) {
      const stale = { ...workspace, version };
      expect(() => decideNamespaceChange(command(operation), { organization, current: stale }))
        .toThrow(expect.objectContaining({ code: 'conflict' }));
    }
  });

  it('delegates scoped uniqueness and request replay/conflicts to one store execution', async () => {
    const fixture = atomicFixture();
    const operation: NamespaceOperation = { kind: 'createOrganization', id: uuid(1),
      request: { scope: { kind: 'installation' }, requestId: uuid(99), name: 'Team', slug: 'team' } };
    const invoke = (next: NamespaceOperation) => mutateNamespace({ operation: next, store: fixture.store, digest });
    const result = await invoke(operation);
    expect(await invoke(operation)).toEqual(result);
    await expect(invoke({ ...operation, request: { ...operation.request, name: 'Changed' } }))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(invoke({ ...operation, id: uuid(21), request: { ...operation.request, requestId: uuid(98) } }))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(invoke({ kind: 'patchOrganization', id: uuid(1), request: {
      scope: { kind: 'installation' }, requestId: uuid(99), expectedVersion: 1, name: 'Update' } }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(fixture.writes).toHaveLength(1);
  });

  it('binds identity, scope, exact intent and expectedVersion to a frozen digest command', () => {
    const operation: NamespaceOperation = { kind: 'patchWorkspace', id: uuid(2),
      request: { scope: workspace.scope, requestId: uuid(99), expectedVersion: 1, name: 'Name' } };
    const accepted = command(operation);
    operation.request.name = 'Mutation';
    expect(accepted.request.name).toBe('Name');
    expect(command(operation).intentDigest).not.toBe(accepted.intentDigest);
    expect(() => prepareNamespaceCommand(operation, () => 'invalid')).toThrow(SemanticError);
  });

  it('treats UUID casing as the same identity and validates organisation slugs', () => {
    const id = 'abcdefab-0000-4000-8000-000000000001';
    expect(sameScope({ ...scope, organizationId: id }, { ...scope, organizationId: id.toUpperCase() })).toBe(true);
    const request = { scope: { kind: 'installation' as const }, requestId: uuid(99), expectedVersion: 1, name: ' Updated ' };
    const result = decideNamespaceChange(command({ kind: 'patchOrganization', id: organization.id, request }),
      { current: organization }).entity;
    expect(result).toEqual({ ...organization, name: 'Updated', version: 2 });
    for (const slug of ['', 'Upper', 'bad--slug', 'a'.repeat(129)]) {
      expect(() => decideNamespaceChange(command({ kind: 'createOrganization', id: uuid(1),
        request: { scope: { kind: 'installation' }, requestId: uuid(99), name: 'Team', slug } }), {})).toThrow(SemanticError);
    }
  });
});

describe('bounded folder placement', () => {
  it('moves within scope without rewriting identity and creates under real root', () => {
    const current = folder(4);
    const parent = folder(5);
    const next = decideNamespaceChange(patchFolder(current.id, { parentFolderId: parent.id }),
      { ...evidence([root, parent]), current }).entity;
    expect(next).toEqual({ ...current, parentFolderId: parent.id, version: 2,
      displayPath: ['Project', 'Folder 5', 'Folder 4'] });
    const create = command({ kind: 'createFolder', id: uuid(6),
      request: { scope, requestId: uuid(99), name: ' Child ', parentFolderId: root.id } });
    expect(decideNamespaceChange(create, evidence()).entity).toEqual({ id: uuid(6), scope,
      version: 1, name: 'Child', parentFolderId: root.id, displayPath: ['Project', 'Child'] });
  });

  it('rejects root reparenting, self/descendant cycles and cross-workspace parent evidence without writes', async () => {
    const current = folder(4);
    const descendant = folder(5, current.id);
    const otherRoot = { ...root, scope: { ...scope, workspaceId: uuid(22) } };
    const cases: [NamespaceCommand, NamespaceEvidence][] = [
      [patchFolder(root.id, { parentFolderId: uuid(5) }), { ...evidence(), current: root }],
      [patchFolder(current.id, { parentFolderId: current.id }), { ...evidence([root, current]), current }],
      [patchFolder(current.id, { parentFolderId: descendant.id }), { ...evidence([root, current, descendant]), current }],
      [patchFolder(current.id, { parentFolderId: root.id }), { ...evidence([otherRoot]), current }],
    ];
    for (const [next, state] of cases) {
      const fixture = atomicFixture(state);
      await expect(fixture.store.execute(next)).rejects.toThrow(SemanticError);
      expect(fixture.writes).toEqual([]);
    }
  });

  it('checks descendant height and bounded, complete ancestry rather than trusting a target depth', () => {
    const current = folder(4);
    const parent = folder(5);
    const next = patchFolder(current.id, { parentFolderId: parent.id });
    expect(() => decideNamespaceChange(next, { ...evidence([root, parent], 6), current })).toThrow(SemanticError);
    expect(decideNamespaceChange(next, { ...evidence([root, parent], 5), current }).entity.version).toBe(2);
    const chain = [root];
    for (let n = 10; n < 18; n++) chain.push(folder(n, chain.at(-1)?.id));
    expect(() => decideNamespaceChange(patchFolder(current.id, { parentFolderId: uuid(17) }),
      { ...evidence(chain), current })).toThrow(SemanticError);
    expect(() => decideNamespaceChange(next, { ...evidence([parent]), current })).toThrow(SemanticError);
    for (const height of [-1, Infinity, 0.5]) {
      expect(() => decideNamespaceChange(next, { ...evidence([root, parent], height), current })).toThrow(SemanticError);
    }
  });

  it('rechecks transaction evidence after command preparation and fails stale moves', () => {
    const current = folder(4);
    const next = patchFolder(current.id, { parentFolderId: uuid(5) });
    const state = { ...evidence([root, folder(5)]), current: { ...current, version: 2 } };
    expect(() => decideNamespaceChange(next, state)).toThrow(expect.objectContaining({ code: 'conflict' }));
    // A prior move made target 5 a descendant before this callback was invoked.
    state.current.version = 1;
    state.folder = { workspace, parentChain: [root, current, folder(5, current.id)], subtreeHeight: 0 };
    expect(() => decideNamespaceChange(next, state)).toThrow(SemanticError);
  });

  it('allows root display rename while retaining the real root identity', () => {
    expect(decideNamespaceChange(patchFolder(root.id, { name: 'Renamed' }), { ...evidence(), current: root }).entity)
      .toEqual({ ...root, name: 'Renamed', displayPath: ['Renamed'], version: 2 });
  });

  it('keeps identical folder names scoped and rejects a folded duplicate within one sibling set', async () => {
    const fixture = atomicFixture(evidence());
    const create: NamespaceOperation = { kind: 'createFolder', id: uuid(4),
      request: { scope, requestId: uuid(99), name: ' Shared ', parentFolderId: root.id } };
    await mutateNamespace({ operation: create, store: fixture.store, digest });
    const duplicate = { ...create, id: uuid(5), request: { ...create.request, requestId: uuid(98), name: 'ＳHARED' } };
    await expect(mutateNamespace({ operation: duplicate, store: fixture.store, digest })).rejects.toMatchObject({ code: 'conflict' });
    const otherScope = { ...scope, organizationId: uuid(21), workspaceId: uuid(22) };
    const otherRoot = { ...root, id: uuid(23), scope: otherScope };
    fixture.setEvidence({ folder: { workspace: { ...workspace, id: uuid(22), rootFolderId: uuid(23),
      scope: { kind: 'organization', organizationId: uuid(21) } }, parentChain: [otherRoot], subtreeHeight: 0 } });
    const other = { ...create, id: uuid(24), request: { ...create.request, scope: otherScope, parentFolderId: otherRoot.id } };
    expect((await mutateNamespace({ operation: other, store: fixture.store, digest })).scope).toEqual(otherScope);
    expect(fixture.writes).toHaveLength(2);
  });
});
