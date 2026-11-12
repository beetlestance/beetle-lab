import { expect, it } from 'vitest';
import { captureDeletionOperation, captureDeletionReply } from '../../src/adapters/outbound/sqlite/output-deletion/index.js';
import { cursor } from '../../src/adapters/outbound/sqlite/output-deletion/cursor.js';
import { begin, file, plan, ready, scope, uuid } from './fixture.js';
it('captures closed bounded private operations without invoking accessors', () => {
  const f = ready(); const {operation, key} = begin(f);
  expect(captureDeletionOperation({...operation, messageId: 1})).toEqual(operation);
  for (const input of [{...operation, extra: true}, {...operation, messageId: 0}, {...operation, padding: 'x'.repeat(12288)},
    {kind: 'getOutputDeletionFile', key: {...key, ordinal: 128}}, {kind: 'scanOutputDeletions', query: {limit: 0}}]) {
    expect(() => captureDeletionOperation(input)).toThrow();
  }
  let accessed = false; const accessor = Object.defineProperty({}, 'kind', {enumerable: true, get() {accessed = true; return operation.kind;}});
  expect(() => captureDeletionOperation(accessor)).toThrow(); expect(accessed).toBe(false);
});
it('rejects substituted scopes, files, records and native commitments at reply boundaries', () => {
  const f = ready(); const {operation, value, key} = begin(f); expect(captureDeletionReply(operation, value)).toEqual(value);
  for (const patch of [{runId: uuid(999)}, {scope: {...scope, workspaceId: uuid(999)}}, {absentCount: 1}, {version: 2}, {metadataBytes: 0}]) {
    expect(() => captureDeletionReply(operation, {...value, ...patch})).toThrow();
  }
  const original = file(f, key); const native = plan(original); const write = {kind: 'recordOutputDeletionPlan' as const, request: {key: {...key, ordinal: 0}, expectedVersion: 1, plan: native}};
  const prepared = f.store.execute(write); expect(captureDeletionReply(write, prepared)).toEqual(prepared);
  for (const patch of [{namespaceIdentity: 'c'.repeat(64)}, {preparationIdentity: 'c'.repeat(64)}, {deletionId: uuid(999)},
    {record: {...original.record, artifact: {...original.record.artifact, sha256: 'f'.repeat(64)}}}]) {
    expect(() => captureDeletionReply(write, {...prepared as object, ...patch})).toThrow();
  }
});
it('admits pending unique summaries and canonical forward discovery cursors only', () => {
  const f = ready(); const {value} = begin(f); const operation = {kind: 'scanOutputDeletions' as const, query: {limit: 1}};
  expect(captureDeletionReply(operation, {items: [value], nextCursor: cursor(1, 1)})).toEqual({items: [value], nextCursor: cursor(1, 1)});
  for (const page of [{items: [value], nextCursor: 'wrong'}, {items: [], nextCursor: cursor(1, 1)},
    {items: [{...value, absentCount: 1, preparedCount: 1, version: 3, stage: 'files_absent'}], nextCursor: null}]) {
    expect(() => captureDeletionReply(operation, page)).toThrow();
  }
  expect(() => captureDeletionReply({...operation, query: {limit: 2}}, {items: [value, value], nextCursor: null})).toThrow();
  expect(() => captureDeletionReply({...operation, query: {limit: 1, cursor: cursor(2, 1)}}, {items: [value], nextCursor: cursor(1, 1)})).toThrow();
});
