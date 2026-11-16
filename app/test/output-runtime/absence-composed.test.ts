import { expect, it, vi } from 'vitest';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputAbsence } from '@beetle/contracts';
import { openOutputRuntime } from '../../src/bootstrap/output-runtime/index.js';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { prepareCancelRunCommand } from '../../src/application/runs/index.js';
import { absenceFixture } from '../output-absence/fixture.js';
import { storageFixture, digest, requestId } from '../storage/fixture.js';
import { snapshotFor } from '../storage/execution-foundation-fixtures.js';
import { ack } from '../storage/events/fixtures.js';
import { loopback, send } from '../runner/fixtures.js';

const storage = storageFixture();
const cases: {mode: string; admission: OutputAbsence['admission']; reason: OutputAbsence['reason']}[] = [
  {mode: 'rejected', admission: {state: 'rejected', reason: 'unsupported_capability'}, reason: 'unsupported_capability'},
  {mode: 'clock_integrity', admission: {state: 'released', disposition: 'never_started'}, reason: 'clock_integrity'},
  {mode: 'never_started', admission: {state: 'released', disposition: 'never_started'}, reason: 'setup_failed'},
  {mode: 'cancelled', admission: {state: 'released', disposition: 'never_started'}, reason: 'cancelled'},
  {mode: 'provisional', admission: {state: 'released', disposition: 'settled'}, reason: 'artifact_incomplete'},
];
it.each(cases)('compiled Metadata and authenticated TCP proof peer close $mode with one bound refresh and retained-proof reopen', async ({mode, admission, reason}) => {
  const f = absenceFixture({admission, reason, end: 3}); f.release({lastSeq: 2}); f.ingest();
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  let metadata = await storage.open(path, {runs: f.config});
  const a = f.key.attempt;
  const runKey = {id: f.key.runId, scope: {kind: 'workspace' as const, organizationId: a.organizationId, workspaceId: a.workspaceId}};
  if (mode === 'cancelled') await metadata.runs.cancel(prepareCancelRunCommand({kind: 'cancelRun', id: f.key.runId,
    request: {scope: runKey.scope, requestId: requestId()}}, digest));
  const snapshot = snapshotFor(f.key, {state: 'exited', lastSeq: 3, admission,
    ...(mode === 'provisional' ? {result: f.value} : {})});
  const requests: string[] = []; const unexpected: string[] = [];
  const prefix = `/runner/v1/attempts/${a.attemptId}`;
  const remote = await loopback((request, response) => {
    requests.push(request.url ?? '');
    expect(request.method).toBe('GET');
    expect(request.headers).toMatchObject({authorization: `Bearer ${remote.loaded.token}`,
      'x-beetle-organization-id': a.organizationId, 'x-beetle-workspace-id': a.workspaceId,
      'x-beetle-generation': '1', 'x-beetle-journal-authority': f.binding.journalAuthority});
    if (request.url === `${prefix}/source`) send(response, {protocolVersion: '1.0', organizationId: a.organizationId,
      workspaceId: a.workspaceId, attemptId: a.attemptId, reason: 'source_absent', retry: 'never', issues: []}, 409);
    else if (request.url === `${prefix}/source/absence`) send(response, f.proof);
    else if (request.url === prefix) send(response, snapshot);
    else {unexpected.push(request.url ?? ''); send(response, {}, 500);}
  });
  const gateway = createRunnerGateway(remote.loaded);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-absence-runtime-'))); await chmod(root, 0o700);
  const failures: unknown[] = [];
  const options = () => ({dataRoot: root, outputs: metadata.outputs, runs: metadata.runs, absences: metadata.absences,
    observations: metadata.dispatch, finalizations: metadata.finalizations, gateway, freeSpaceReserveBytes: 0, intervalMs: 25,
    onFailure: async (error: unknown) => {failures.push(error);}});
  let runtime = await openOutputRuntime(options());
  try {
    const charged = (await metadata.inputs.storage()).chargedBytes;
    await vi.waitFor(async () => {
      expect(await metadata.absences.read(f.binding)).toMatchObject({closure: f.proof});
      const original = await metadata.events.load(f.binding); expect(original).toMatchObject({durableThrough: 3});
      const current = await metadata.runs.getRun(runKey); expect(current.state).toBe('finalizing');
      expect(requests.filter(url => url === prefix)).toHaveLength(1);
    }, {timeout: 5000, interval: 25});
    // Full confirmed ACK remains real Metadata authority; no receipt or credit before it.
    expect((await metadata.runs.getRun(runKey)).outcome).toBe('pending');
    expect((await metadata.inputs.storage()).chargedBytes).toBe(charged);
    expect(requests.filter(url => url.endsWith('/source/absence'))).toHaveLength(1);
    await runtime.close(); await storage.close(metadata);
    metadata = await storage.open(path, {runs: f.config});
    await metadata.events.confirmAck({binding: f.binding, throughSeq: 3, receipt: ack(f.binding, 3)});
    runtime = await openOutputRuntime(options());
    await vi.waitFor(async () => expect(await metadata.runs.getRun(runKey)).toMatchObject({
      state: mode === 'cancelled' ? 'cancelled' : 'errored', outcome: 'inconclusive', validationStatus: 'pending', reason,
    }), {timeout: 5000, interval: 25});
    expect(requests.filter(url => url.endsWith('/source/absence'))).toHaveLength(1);
    expect(requests.filter(url => url === prefix)).toHaveLength(1);
    await runtime.close(); await storage.close(metadata);
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare('SELECT count(*) n FROM execution_output_absence_finalizations').get()?.n).toBe(1);
      expect(db.prepare('SELECT count(*) n FROM execution_output_sources').get()?.n).toBe(0);
      expect(db.prepare('SELECT count(*) n FROM execution_output_slots').get()?.n).toBe(0);
      const carrier = db.prepare('SELECT kind,canonical_json FROM execution_output_payloads').get();
      if (mode === 'provisional') expect(carrier).toEqual({kind: 'result', canonical_json: encodeCanonicalJson(f.value, 65536)});
      else expect(carrier).toBeUndefined();
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {db.close();}
    expect(failures).toEqual([]); expect(unexpected).toEqual([]);
  } finally {
    await runtime.close(); await gateway.close(); await remote.close(); await storage.close(metadata);
    await rm(root, {force: true, recursive: true});
  }
});
