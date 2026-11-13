import { prepareOutputDeletion } from '../../src/application/output-deletion/index.js';
import type { OutputDeletionSummary, OutputDeletionFile } from '../../src/ports/output-deletion-metadata.js';
import { finalizationFixture, artifact, uuid, scope } from '../output-finalization/fixture.js';
import { hash } from '../storage/output-payload-fixtures.js';
export { uuid, scope } from '../output-finalization/fixture.js';
export function ready(count = 1, owner?:NonNullable<Parameters<typeof finalizationFixture>[0]>['owner']) {
  const descriptors = Array.from({length: count}, (_, index) => ({...artifact, artifactId: uuid(1000 + index), relativePath: `artifact-${index}.bin`, bytes: 1}));
  const f = finalizationFixture({artifacts: descriptors, maximum: 100000,...(owner?{owner,storageBytes:4000000}:{})}); f.ready();
  const rows = f.db.prepare('SELECT ordinal,slot_json FROM execution_output_slots ORDER BY ordinal').all();
  const update = f.db.prepare('UPDATE execution_output_slots SET slot_json=? WHERE ordinal=?');
  for (const row of rows) {
    const slot = JSON.parse(row.slot_json as string) as object;
    update.run(JSON.stringify({...slot, v: 2, w: uuid(99)}), row.ordinal!);
    update.run(JSON.stringify({...slot, v: 3, o: 1, i: 'd'.repeat(64), w: uuid(99)}), row.ordinal!);
    update.run(JSON.stringify({...slot, v: 4, o: 1, i: 'd'.repeat(64), w: uuid(99), p: 'publishing'}), row.ordinal!);
    update.run(JSON.stringify({...slot, v: 5, o: 1, i: 'e'.repeat(64), w: null, p: 'published'}), row.ordinal!);
  }
  if (f.finalize().kind !== 'finalized') throw new Error('Synthetic source not finalized');
  return f;
}
export function command(f: {key: {runId: string}; reads: ReturnType<typeof ready>['reads']}, id = 400, requestId = 500) {
  const run = f.reads.get({scope, id: f.key.runId});
  return prepareOutputDeletion({kind: 'beginOutputDeletion', id: uuid(id), requestedAt: '2026-11-12T00:00:00.000Z',
    request: {scope, runId: run.id, requestId: uuid(requestId), expectedRunVersion: run.version}}, hash);
}
export function begin(f: ReturnType<typeof ready>, id = 400, requestId = 500) {
  const operation = {kind: 'beginOutputDeletion' as const, command: command(f, id, requestId)};
  const value = f.store.execute(operation) as OutputDeletionSummary;
  return {operation, value, key: {id: value.id, scope, runId: value.runId}};
}
export function file(f: ReturnType<typeof ready>, key: ReturnType<typeof begin>['key'], ordinal = 0) {
  return f.store.execute({kind: 'getOutputDeletionFile', key: {...key, ordinal}}) as OutputDeletionFile;
}
/** Synthetic native responses for metadata-only guard tests; actual native proof is separate. */
export function plan(value: OutputDeletionFile, namespaceIdentity = 'a'.repeat(64)) {
  return {record: value.record, deletionId: value.deletionId, deletionVersion: value.deletionVersion, namespaceIdentity, preparationIdentity: 'b'.repeat(64)};
}
