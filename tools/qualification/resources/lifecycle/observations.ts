import assert from 'node:assert/strict';
import {join} from 'node:path';
import type {Run, ApiClient, RunEventPage} from '@beetle/contracts/api';
import type {Fixture} from '../../native-application/compose/fixture.js';
import {record, counter} from '../values.js';
export function params(run: Run) {return {organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId, runId: run.id};}
export function counts(f: Fixture) {
  const id = f.compose('ps', '-q', 'synthetic-target'); assert.match(id, /^[a-f0-9]{64}$/);
  const program = "fetch('http://127.0.0.1:8080/counts',{signal:AbortSignal.timeout(2000)}).then(r=>r.text()).then(s=>{if(s.length>256)process.exit(3);console.log(s)}).catch(()=>process.exit(2));";
  const row = record(f.docker.json<unknown>(['exec', id, 'node', '-e', program]));
  return {ready: counter(row.ready), work: counter(row.work), unexpected: counter(row.unexpected)};
}
function originalId(f: Fixture, run: Run, installation: string) {
  const ids = f.docker.run(['ps', '-aq', '--no-trunc', '--filter', `label=dev.beetle.installation=${installation}`,
    '--filter', `label=dev.beetle.attempt=${run.activeAttemptId}`]).split('\n').filter(Boolean);
  assert(ids.length <= 1); const id = ids[0]; if (id !== undefined) assert.match(id, /^[a-f0-9]{64}$/); return id;
}
function inspectedRuntime(f: Fixture, run: Run, installation: string, id: string) {
  const rows = f.docker.json<unknown[]>(['inspect', id]); assert.equal(rows.length, 1); const row = record(rows[0]);
  assert.equal(row.Id, id); assert.equal(row.Image, f.imageIds.engine);
  const labels = record(record(row.Config).Labels); assert.equal(labels['dev.beetle.generation'], '1');
  assert.equal(labels['dev.beetle.attempt'], run.activeAttemptId); assert.equal(labels['dev.beetle.installation'], installation);
  const controls = record(row.HostConfig); assert.equal(controls.Memory, 536870912); assert.equal(controls.NanoCpus, 1000000000); assert.equal(controls.PidsLimit, 128);
  return {id, state: record(row.State)};
}
export function runtime(f: Fixture, run: Run, installation: string) {
  const id = originalId(f, run, installation); assert(id); return inspectedRuntime(f, run, installation, id);
}
/** API active can precede native creation/start. Absence never establishes observation. */
export function runningRuntime(f: Fixture, run: Run, installation: string) {
  const id = originalId(f, run, installation); if (id === undefined) return null;
  const captured = inspectedRuntime(f, run, installation, id); return captured.state.Running === true ? captured : null;
}
export function stopForCustody(f: Fixture) {
  f.compose('stop', 'backend');
  const id = f.compose('ps', '--all', '-q', 'backend'); assert.match(id, /^[a-f0-9]{64}$/);
  const rows = f.docker.json<unknown[]>(['inspect', id]); assert.equal(rows.length, 1);
  const backend = record(rows[0]); assert.equal(backend.Image, f.imageIds.backend); assert.equal(record(backend.State).Running, false);
  assert.equal(record(record(backend.Config).Labels)['com.docker.compose.project'], f.project);
}
export function ledger(f: Fixture, run: Run, installation: string) {
  const program = "const fs=require('node:fs'),crypto=require('node:crypto');const path=process.argv[1];if(fs.statSync(path).size>16777216)process.exit(3);const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');const before=hash();const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true,timeout:1000});try{db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000');const rows=db.prepare('SELECT execution_charged,event_pending,snapshot_json FROM execution_records WHERE attempt_id=? LIMIT 2').all(process.argv[2]);const allocations=db.prepare('SELECT charged_bytes FROM attempt_output_allocations WHERE attempt_id=? LIMIT 2').all(process.argv[2]);const text=JSON.stringify({rows,allocations});if(text.length>524288)process.exit(3);console.log(text)}finally{db.close();if(hash()!==before)process.exit(4)}";
  const row = record(f.docker.json<unknown>(['run', '--rm', '--pull', 'never', '--name', `${f.project}-ledger-${run.id}`,
    '--label', `dev.beetle.installation=${installation}`, '--network', 'none', '--read-only', '--user', '1000:1000',
    '--cpus', '1', '--memory', '256m', '--pids-limit', '64', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--mount', `type=bind,source=${join(f.home, 'data/backend')},target=${join(f.home, 'data/backend')}`,
    '--entrypoint', 'node', f.images.backend!, '-e', program, join(f.home, 'data/backend/metadata.sqlite'), run.activeAttemptId]));
  assert(Array.isArray(row.rows) && row.rows.length === 1); assert(Array.isArray(row.allocations) && row.allocations.length === 1);
  const execution = record(row.rows[0]); assert.equal(execution.execution_charged, 0); assert.equal(execution.event_pending, 0);
  assert(typeof execution.snapshot_json === 'string' && Buffer.byteLength(execution.snapshot_json) <= 73728);
  const snapshot = record(JSON.parse(execution.snapshot_json)); assert.equal(snapshot.state, 'exited');
  assert.deepEqual(snapshot.admission, {state: 'released', disposition: 'settled'});
  const chargedBytes = counter(record(row.allocations[0]).charged_bytes); assert(chargedBytes > 0);
  return {executionReleased: true, originalAllocationChargedBytes: chargedBytes, exit: snapshot.exitEvidence};
}
type ResourceSummary = Extract<RunEventPage['items'][number], {kind: 'resource.summary'}>['payload'];
export async function summaries(api: ApiClient, run: Run, captured?: (rows: ResourceSummary[]) => void) {
  const result = await api.listRunEvents({params: params(run), query: {limit: 100}});
  assert(result.ok); const page = result.value; assert.equal(page.generation, 1); assert.equal(page.blockedReason, null); assert.equal(page.nextCursor, null);
  const rows = page.items.filter(event => event.kind === 'resource.summary').map(event => event.payload);
  captured?.(rows);
  assert(rows.length > 0);
  assert(rows.some(row => row.samples > 0 && row.cpuMillis !== null && row.peakMemoryBytes !== null && row.peakPids !== null));
  for (const row of rows) {
    assert.equal(row.source, 'docker-stats'); assert.equal(row.scope, 'container'); assert.equal(row.outputBytes, null);
    if (row.peakMemoryBytes !== null) assert(row.peakMemoryBytes <= 536870912);
    if (row.peakPids !== null) assert(row.peakPids <= 128);
    assert(row.enforcedControls.every(control => ['cpu', 'memory', 'pids'].includes(control)));
  }
  return rows;
}
