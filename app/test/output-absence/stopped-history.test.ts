import { expect, it, vi } from 'vitest';
import { absenceFixture } from './fixture.js';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas } from '@beetle/contracts/api';
import { ApiFault, createApiServer } from '../../src/adapters/inbound/http/api-errors.js';
import { registerRunMetricRoutes } from '../../src/adapters/inbound/http/run-metrics/index.js';
import { configureSchemaCompilers } from '../../src/adapters/inbound/http/schema-compilers.js';
import { classifyMetadataError } from '../../src/bootstrap/metadata-errors.js';
import { protectHistorical } from '../../src/bootstrap/historical.js';
import { command } from '../output-deletion/fixture.js';
import { scope, storageFixture, uuid } from '../storage/fixture.js';
import { observed } from './stopped-history-fixture.js';

const storage = storageFixture();

type Fixture = ReturnType<typeof absenceFixture>;
const observations = (f: Fixture) => f.db.prepare('SELECT * FROM execution_stopped_history').all();

function prepare(f: Fixture) {
  f.adopt();
  f.release({ exitEvidence: { exitCode: 137, oomKilled: true, observedAt: '2026-01-01T00:01:00Z' } });
  f.ingest();
}
const finalize = (f: Fixture, stoppedHistory: 'fetch' | ReturnType<typeof observed>) =>
  f.absences.execute({ kind: 'absenceFinalize', request: { ...f.command(), stoppedHistory } });

it('fetches only after exact ACK and settles recovered bytes with one immutable receipt', () => {
  const f = absenceFixture();
  prepare(f);
  expect(finalize(f, 'fetch')).toEqual({ kind: 'pending', reason: 'events' });
  f.confirm();
  expect(finalize(f, 'fetch')).toEqual({ kind: 'pending', reason: 'history' });
  const sample = observed(f);
  const charged = f.usage();
  const events = Number(f.cursor().retained_bytes);
  const reply = finalize(f, sample);
  expect(reply).toMatchObject({
    kind: 'finalized',
    receipt: {
      retainedPayloadBytes: events + sample.bytes,
      refundedBytes: 10000 - events - sample.bytes,
      reason: 'memory_limit',
    },
  });
  expect(f.usage()).toBe(charged - (10000 - events - sample.bytes));
  expect(observations(f)).toEqual([
    expect.objectContaining({ canonical_json: sample.json, digest: sample.digest, bytes: sample.bytes }),
  ]);
  expect(finalize(f, 'fetch')).toEqual(reply);
  expect(finalize(f, sample)).toEqual(reply);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('settles ordinary partial output when the verified observation would exceed the remaining budget', () => {
  const seed = absenceFixture();
  prepare(seed);
  const bytes = Number(seed.cursor().retained_bytes);
  const f = absenceFixture({ maximum: bytes + 1 });
  prepare(f);
  f.confirm();
  expect(finalize(f, observed(f))).toMatchObject({
    kind: 'finalized',
    receipt: { retainedPayloadBytes: bytes, refundedBytes: 1 },
  });
  expect(observations(f)).toEqual([]);
});

it('rejects invalid bytes and later raw inserts without changing the receipt', () => {
  const f = absenceFixture();
  prepare(f);
  f.confirm();
  const valid = observed(f);
  expect(() => finalize(f, { ...valid, digest: 'f'.repeat(64) })).toThrow();
  expect(observations(f)).toEqual([]);
  const receipt = f.finalize();
  expect(() =>
    f.db
      .prepare(
        'INSERT INTO execution_stopped_history(attempt_id,proof_digest,canonical_json,digest,bytes) VALUES(?,?,?,?,?)',
      )
      .run(f.binding.key.attempt.attemptId, f.command().proofDigest, valid.json, valid.digest, valid.bytes),
  ).toThrow(/stopped history requires/);
  expect(f.finalize()).toEqual(receipt);
});

it('reads only finalized stopped history for the scoped current attempt', () => {
  const f = absenceFixture();
  prepare(f);
  f.confirm();
  const key = { id: f.key.runId, scope, attemptId: f.key.attempt.attemptId };
  const read = (input = key) => f.store.execute({ kind: 'getRunStoppedHistory', key: input });
  const sample = observed(f);
  expect(() => read()).toThrow(expect.objectContaining({ code: 'not_found' }));
  finalize(f, sample);
  expect(read()).toEqual(JSON.parse(sample.json));
  expect(() => read({ ...key, attemptId: uuid(1000) })).toThrow(expect.objectContaining({ code: 'not_found' }));
  expect(() => read({ ...key, scope: { ...scope, workspaceId: uuid(1001) } })).toThrow(
    expect.objectContaining({ code: 'not_found' }),
  );
  f.store.execute({ kind: 'beginOutputDeletion', command: command(f) });
  expect(() => read()).toThrow(expect.objectContaining({ code: 'not_found' }));
});

it('serves the exact retained samples through authenticated HTTP from a read-only metadata worker', async () => {
  const f = absenceFixture();
  prepare(f);
  f.confirm();
  const sample = observed(f);
  finalize(f, sample);
  const path = storage.path();
  f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, {
    readOnly: true,
    runtime: null,
    runs: f.config,
    installation: f.settings.chain(scope).installation,
  });
  const server = createApiServer({ classify: classifyMetadataError });
  protectHistorical(server);
  configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
  const routes = registerRunMetricRoutes(server, {
    authorize: async (request) => {
      if (!request.headers.cookie) throw new ApiFault('forbidden');
    },
    service: {
      reader: {
        getRunChartHistory: vi.fn(),
        getRunMetricOverview: vi.fn(),
        listRunMetricSeries: vi.fn(),
        getRunMetricSamples: vi.fn(),
        getRunLatencyAttribution: vi.fn(),
      },
      lookupRunMetricSeries: vi.fn(),
      readRunHistorySummary: vi.fn(),
      close: async () => undefined,
    },
    stoppedHistory: metadata.stoppedHistory,
  });
  try {
    const base = `/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/runs/${f.key.runId}/attempts`;
    const url = `${base}/${f.key.attempt.attemptId}/metrics/stopped-history`;
    expect((await server.inject({ url })).statusCode).toBe(403);
    const headers = { cookie: 'test-session=authenticated' };
    const response = await server.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(JSON.parse(sample.json));
    const foreign = await server.inject({ url: `${base}/${uuid(1001)}/metrics/stopped-history`, headers });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: 'not_found' });
  } finally {
    await routes.close();
    await server.close();
    await storage.close(metadata);
  }
});
