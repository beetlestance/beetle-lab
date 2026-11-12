import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { createRunMetricsService } from '../../../src/application/run-metrics/index.js';
import { createRunComparisonService } from '../../../src/application/run-comparison/index.js';
import { nativeFixture } from '../../run-metrics/native-fixture.js';
import { digest as streamDigest } from '../../run-metrics/fixture.js';
import { digest, storageFixture, scope, uuid } from '../../storage/fixture.js';
import { cancelCommand } from '../../storage/run-cancellation-fixtures.js';
import { httpFixture } from './fixture.js';
const storage = storageFixture();
function facts(path: string): string {
  const db = new DatabaseSync(path, {readOnly: true});
  const tables = ['runs', 'attempts', 'suite_revisions', 'event_cursors', 'run_events', 'execution_output_sources',
    'execution_output_payloads', 'execution_output_finalizations', 'attempt_output_allocations', 'installation_storage_usage', 'receipts'];
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN;');
    const records = tables.map(table => {const rows = db.prepare(`SELECT * FROM ${table} LIMIT 129`).all(); expect(rows.length).toBeLessThanOrEqual(128); return {table, rows};});
    return digest(encodeCanonicalJson(records, 2097152));
  } finally {db.close();}
}
it('compares actual worker runs and verified numeric files over authenticated TCP without changing storage/events/receipts', async () => {
  const f = await nativeFixture(); f.add(80); f.store.execute({kind: 'cancelRun', command: cancelCommand(uuid(80))});
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path); const before = facts(path); const metadata = await storage.open(path);
  const metrics = createRunMetricsService({artifacts: metadata.runArtifacts, bytes: f.files.store, createDigest: streamDigest});
  const service = createRunComparisonService({runs: metadata.runs, results: metadata.results, suites: metadata.suites, metrics, digest});
  let http: Awaited<ReturnType<typeof httpFixture>> | undefined;
  try {
    http = await httpFixture(service);
    const params = {organizationId: scope.organizationId, workspaceId: scope.workspaceId};
    const body = {scope, runIds: [f.key.runId, uuid(80)], metric: {metric: 'http_req_duration', kind: 'trend' as const,
      scope: 'execute' as const, tags: {phase: 'execute' as const, request: 'r0'}}};
    const response = await http.client.compareRuns({params, body});
    expect(response.ok, JSON.stringify(response)).toBe(true); if (!response.ok) throw new Error('Comparison failed');
    expect(response.value.items[0]!.metric).toMatchObject({availability: 'ready', series: {metric: 'http_req_duration', total: {kind: 'trend', count: 3, mean: 3}}});
    expect(response.value.items[1]!).toMatchObject({run: {state: 'cancelled', outcome: 'inconclusive'}, result: null,
      metric: {availability: 'unavailable', reason: 'result_absent', series: null}});
    const foreign = await http.client.compareRuns({params, body: {...body, runIds: [f.key.runId, uuid(999)]}});
    expect(foreign).toMatchObject({ok: false, error: {kind: 'protocol', status: 404}});
    await http.close(); await metrics.close(); await storage.close(metadata);
    expect(facts(path)).toBe(before);
  } finally {
    try {await http?.close();} finally {try {await service.close(); await metrics.close();} finally {await storage.close(metadata); await f.files.dispose();}}
  }
});
