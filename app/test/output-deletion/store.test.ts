import { expect, it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputDeletionSummary } from '../../src/ports/output-deletion-metadata.js';
import { prepareOutputDeletion } from '../../src/application/output-deletion/index.js';
import { hash } from '../storage/output-payload-fixtures.js';
import { begin, command, file, plan, ready, scope, uuid } from './fixture.js';
function retained(f: ReturnType<typeof ready>): string {
  const tables = ['runs','attempts','execution_records','attempt_output_allocations','execution_output_sources','execution_output_payloads','execution_output_slots','execution_output_finalizations','event_cursors','run_events','installation_storage_usage'];
  return encodeCanonicalJson(tables.map(table => ({table, rows: f.db.prepare(`SELECT * FROM ${table} LIMIT 129`).all()})), 2097152);
}
it('captures settled slots, persists progress exactly once and preserves every charge and producer authority row', () => {
  const f = ready(); const before = retained(f); const {operation, value, key} = begin(f);
  expect(value).toMatchObject({kind: 'source', stage: 'pending', version: 1, fileCount: 1, preparedCount: 0, absentCount: 0, metadataBytes: 65536});
  const original = file(f, key); const native = plan(original);
  const prepare = {kind: 'recordOutputDeletionPlan' as const, request: {key: {...key, ordinal: 0}, expectedVersion: 1, plan: native}};
  expect(f.store.execute(prepare)).toMatchObject({phase: 'prepared', version: 2}); expect(f.store.execute(prepare)).toMatchObject({phase: 'prepared', version: 2});
  const absent = {kind: 'recordOutputDeletionAbsence' as const, request: {key: {...key, ordinal: 0}, expectedVersion: 2, receipt: {...native, phase: 'absent' as const}}};
  expect(f.store.execute(absent)).toMatchObject({phase: 'absent', version: 3}); expect(f.store.execute(absent)).toMatchObject({phase: 'absent', version: 3});
  expect(f.store.execute({kind: 'getOutputDeletion', key})).toMatchObject({stage: 'files_absent', version: 3, preparedCount: 1, absentCount: 1});
  expect(f.store.execute(operation)).toEqual(value); expect(retained(f)).toBe(before);
  expect(f.store.execute({kind: 'scanOutputDeletions', query: {limit: 32}})).toEqual({items: [], nextCursor: null});
});
it('distinguishes a source with zero files without treating it as an uncharged or purged run', () => {
  const f = ready(0); const before = f.usage(); const {value} = begin(f);
  expect(value).toMatchObject({kind: 'source', stage: 'files_absent', fileCount: 0, metadataBytes: 65536});
  expect(value.retainedPayloadBytes).toBeGreaterThan(0); expect(f.usage()).toBe(before);
});
it('binds Begin replay before allocation identity/time and version checks, rejecting changed intent and scope', () => {
  const f = ready(); const {operation, value, key} = begin(f);
  expect(f.store.execute({...operation, command: {...operation.command, id: uuid(401), requestedAt: '2026-11-12T00:00:01.000Z'}})).toEqual(value);
  const changed = prepareOutputDeletion({kind: 'beginOutputDeletion', id: operation.command.id, requestedAt: operation.command.requestedAt, request: {...operation.command.request, expectedRunVersion: 99}}, hash);
  expect(() => f.store.execute({...operation, command: changed})).toThrow();
  expect(() => f.store.execute({kind: 'beginOutputDeletion', command: command(f, 402, 502)})).toThrow();
  expect(() => f.store.execute({kind: 'getOutputDeletion', key: {...key, scope: {...scope, organizationId: uuid(999)}}})).toThrow();
  expect(() => f.store.execute({kind: 'getOutputDeletionFile', key: {...key, ordinal: 1}})).toThrow();
});
it('fences new artifact inventory/content after Begin while preserving result/finalization replay facts', () => {
  const f = ready(); begin(f); const key = {scope, id: f.key.runId, attemptId: f.key.attempt.attemptId};
  expect(() => f.store.execute({kind: 'listRunArtifacts', query: {...key, limit: 100}})).toThrow('not_found');
  expect(() => f.store.execute({kind: 'getRunArtifact', key: {...key, artifactId: uuid(1000)}})).toThrow('not_found');
  expect(f.finalize()).toMatchObject({kind: 'finalized'});
  expect(f.store.execute({kind: 'getRunResult', key: {scope, id: f.key.runId}})).toMatchObject({result: {outcome: 'passed'}});
});
it('captures all128 slots without returning a corpus and pages pending intents with canonical cursors', () => {
  const f = ready(128); const first = begin(f); expect(first.value.fileCount).toBe(128);
  expect(file(f, first.key, 127).record.artifact.ordinal).toBe(127);
  const page = f.store.execute({kind: 'scanOutputDeletions', query: {limit: 1}}) as {items: OutputDeletionSummary[]; nextCursor: string | null};
  expect(page.items).toHaveLength(1); expect(page.nextCursor).toBeNull();
  expect(() => f.store.execute({kind: 'scanOutputDeletions', query: {limit: 33}})).toThrow();
  expect(() => f.store.execute({kind: 'scanOutputDeletions', query: {limit: 1, cursor: 'wrong'}})).toThrow();
});
