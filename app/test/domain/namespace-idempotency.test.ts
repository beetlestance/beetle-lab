import { describe, expect, it } from 'vitest';
import { mutateNamespace, prepareNamespaceCommand } from '../../src/application/namespaces/index.js';
import { decideNamespaceChange, SemanticError } from '../../src/domain/namespaces/index.js';
import type { NamespaceChange, NamespaceEntity, NamespaceEvidence, NamespaceOperation,
  NamespaceStore } from '../../src/ports/namespaces.js';
import { digest, folder, organization, root, scope, uuid, workspace } from './fixtures.js';

type CreateOperation = Extract<NamespaceOperation,
  { kind: 'createOrganization' | 'createWorkspace' | 'createFolder' }>;
const createCases: { operation: CreateOperation; entity: NamespaceEntity; evidence: NamespaceEvidence }[] = [
  { operation: { kind: 'createOrganization', id: organization.id,
    request: { scope: organization.scope, requestId: uuid(99), name: organization.name, slug: organization.slug } },
    entity: organization, evidence: {} },
  { operation: { kind: 'createWorkspace', id: workspace.id, rootFolderId: root.id,
    request: { scope: workspace.scope, requestId: uuid(99), name: workspace.name } },
    entity: workspace, evidence: { organization } },
  { operation: { kind: 'createFolder', id: uuid(4), request: { scope, requestId: uuid(99),
    name: 'Folder 4', parentFolderId: root.id } }, entity: folder(4),
    evidence: { folder: { workspace, parentChain: [root], subtreeHeight: 0 } } },
];

function reallocate(operation: CreateOperation): CreateOperation {
  if (operation.kind === 'createWorkspace') return { ...operation, id: uuid(80), rootFolderId: uuid(81) };
  return { ...operation, id: uuid(80) };
}

/** Only a scoped receipt model; no SQL, isolation or cross-process guarantee. */
function receiptStore(evidence: NamespaceEvidence): { store: NamespaceStore; writes: NamespaceChange[] } {
  const receipts = new Map<string, { digest: string; entity: NamespaceEntity }>();
  const writes: NamespaceChange[] = [];
  return { writes, store: { async execute(command) {
    const key = JSON.stringify([command.request.scope, command.request.requestId]);
    const receipt = receipts.get(key);
    if (receipt) {
      if (receipt.digest !== command.intentDigest) throw new SemanticError('conflict');
      return receipt.entity;
    }
    const change = decideNamespaceChange(command, evidence);
    writes.push(change);
    receipts.set(key, { digest: command.intentDigest, entity: change.entity });
    return change.entity;
  } } };
}

describe.each(createCases)('$operation.kind retry allocations', ({ operation, entity, evidence }) => {
  it('hashes the same client intent equally after fresh server allocations', () => {
    const original = prepareNamespaceCommand(operation, digest);
    const retry = prepareNamespaceCommand(reallocate(operation), digest);
    expect(retry.intentDigest).toBe(original.intentDigest);
    expect(prepareNamespaceCommand(original, digest).intentDigest).toBe(original.intentDigest);
    expect(retry.id).toBe(uuid(80));
    if (retry.kind === 'createWorkspace') expect(retry.rootFolderId).toBe(uuid(81));
  });

  it('replays the original receipt and workspace root instead of creating fresh identities', async () => {
    const synthetic = receiptStore(evidence);
    const first = await mutateNamespace({ operation, store: synthetic.store, digest });
    const replayed = await mutateNamespace({ operation: reallocate(operation), store: synthetic.store, digest });
    expect(first).toEqual(entity);
    expect(replayed).toEqual(entity);
    expect(Object.isFrozen(replayed.scope)).toBe(true);
    expect(synthetic.writes).toHaveLength(1);
    if (operation.kind === 'createWorkspace') {
      expect(synthetic.writes[0]?.rootFolder).toEqual(root);
      expect('rootFolderId' in replayed && replayed.rootFolderId).toBe(root.id);
    }
  });

  it('accepts an original CREATE receipt even when the current allocation has another ID', async () => {
    const store: NamespaceStore = { async execute() { return entity; } };
    expect(await mutateNamespace({ operation: reallocate(operation), store, digest })).toEqual(entity);
  });

  it('still rejects changed client intent under the original scoped requestId', async () => {
    const synthetic = receiptStore(evidence);
    await mutateNamespace({ operation, store: synthetic.store, digest });
    const changed = reallocate(operation);
    changed.request = { ...changed.request, name: 'Changed client name' };
    await expect(mutateNamespace({ operation: changed, store: synthetic.store, digest }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(synthetic.writes).toHaveLength(1);
  });
});

describe('namespace response binding', () => {
  it.each(createCases)('rejects CREATE receipts from another owner for $operation.kind', async ({ operation, entity }) => {
    const wrongScope = entity.scope.kind === 'installation' ? workspace.scope : { kind: 'installation' as const };
    const store: NamespaceStore = { async execute() { return { ...entity, scope: wrongScope } as NamespaceEntity; } };
    await expect(mutateNamespace({ operation, store, digest })).rejects.toMatchObject({ code: 'not_found' });
  });

  it.each(createCases)('rejects a wrong entity kind with the requested owner for $operation.kind', async ({ operation }) => {
    const malformed = { id: operation.id, scope: operation.request.scope, version: 1, name: 'Wrong kind' };
    const store: NamespaceStore = { async execute() { return malformed as NamespaceEntity; } };
    await expect(mutateNamespace({ operation, store, digest })).rejects.toMatchObject({ code: 'not_found' });
  });

  it.each([
    { kind: 'patchOrganization', id: organization.id, request: { scope: organization.scope,
      requestId: uuid(99), expectedVersion: 1, name: 'Updated' } },
    { kind: 'patchWorkspace', id: workspace.id, request: { scope: workspace.scope,
      requestId: uuid(99), expectedVersion: 1, name: 'Updated' } },
    { kind: 'patchFolder', id: uuid(4), request: { scope, requestId: uuid(99), expectedVersion: 1, name: 'Updated' } },
  ] satisfies NamespaceOperation[])('retains PATCH route/version intent and returned ID binding for $kind', async operation => {
    const original = prepareNamespaceCommand(operation, digest);
    expect(prepareNamespaceCommand({ ...operation, id: uuid(80) }, digest).intentDigest).not.toBe(original.intentDigest);
    const newer = structuredClone(operation);
    newer.request.expectedVersion = 2;
    expect(prepareNamespaceCommand(newer, digest).intentDigest).not.toBe(original.intentDigest);
    expect(prepareNamespaceCommand(original, digest).intentDigest).toBe(original.intentDigest);
    const entity = operation.kind === 'patchOrganization' ? organization : operation.kind === 'patchWorkspace' ? workspace : folder(4);
    const store: NamespaceStore = { async execute() { return { ...entity, id: uuid(80) }; } };
    await expect(mutateNamespace({ operation, store, digest })).rejects.toMatchObject({ code: 'not_found' });
  });
});
