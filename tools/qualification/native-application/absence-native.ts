import assert from 'node:assert/strict';
import { validate } from '@beetle/contracts';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import { request } from '../../../agent/test/container/docker.js';
import type { Inspection } from '../../../agent/test/container/docker.js';
import type { Fixture } from '../../../agent/test/container/fixture.js';
import type { inspectAbsence } from './absence-evidence.js';

export function noEngineExecutions(f: Fixture) {
  const ids = f.docker.run(['ps', '-aq', '--no-trunc', '--filter', `label=dev.beetle.installation=${f.id}`]);
  assert.equal(ids, '', 'Rejected attempt must never create an engine container');
  return 0;
}
export function verifyAgentAbsence(f: Fixture, physical: ReturnType<typeof inspectAbsence>) {
  const proof = physical.proof;
  const headers = { 'x-beetle-organization-id': proof.organizationId, 'x-beetle-workspace-id': proof.workspaceId,
    'x-beetle-generation': '1', 'x-beetle-journal-authority': proof.journalAuthority };
  const get = (suffix: string) => request(f.docker, { agent: f.agent, credentialFile: f.tokenPath,
    path: `/runner/v1/attempts/${proof.attemptId}${suffix}`, headers });
  const response = get(''); assert.equal(response.status, 200); assert(Buffer.byteLength(response.body) <= 2048);
  const snapshot = validate('AttemptSnapshot', JSON.parse(response.body) as unknown); assert(snapshot.ok);
  assert.deepEqual(snapshot.value, physical.snapshot);
  const absence = get('/source/absence'); assert.equal(absence.status, 200); assert(Buffer.byteLength(absence.body) <= 2048);
  assert.deepEqual(captureOutputAbsence(JSON.parse(absence.body) as unknown), proof);
  const source = get('/source'); assert.equal(source.status, 409); assert(Buffer.byteLength(source.body) <= 2048);
  const error = validate('ProtocolError', JSON.parse(source.body) as unknown); assert(error.ok);
  assert.equal(error.value.reason, 'source_absent'); assert.equal(error.value.retry, 'never');
  return { snapshot: snapshot.value, absence: proof, ordinarySource: error.value };
}
export function stopAgent(f: Fixture) {
  f.docker.run(['stop', '-t', '10', f.agent]);
  const actual = f.docker.json<Inspection[]>(['inspect', f.agent]); assert.equal(actual.length, 1);
  assert.equal(actual[0]!.State.Running, false); assert.equal(actual[0]!.State.ExitCode, 0);
  assert.equal(actual[0]!.State.OOMKilled, false);
}
