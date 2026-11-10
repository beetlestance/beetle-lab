import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AttemptSnapshot, Offer, ProtocolError } from '@beetle/contracts';
import { validate } from '@beetle/contracts';
import type { RunProfilePin } from '../../src/ports/runs.js';
import { loopback, loaded, send } from '../runner/fixtures.js';
import { capabilities } from '../capacity/fixture.js';
import { snapshotFor } from '../storage/execution-foundation-fixtures.js';
import { scope, uuid } from '../storage/fixture.js';
import { eventHttpPeer } from './event-http-peer.js';

export const journalAuthority = '33333333-3333-4333-8333-333333333333';
async function body(request: IncomingMessage): Promise<string> {
  const bytes = Buffer.alloc(2_097_152); let size = 0;
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Unexpected fixture chunk');
    if (size + chunk.length > bytes.length) throw new Error('Fixture request bound');
    chunk.copy(bytes, size); size += chunk.length;
  }
  return bytes.toString('utf8', 0, size);
}
function frame(pin: RunProfilePin) {
  const value = capabilities(Date.now() - 20);
  value.observation.installationId = uuid(10);
  value.capacity.pids = 100;
  value.observation.pool.stagingBytes = 10_485_760;
  value.observation.perRunStagingBytes = 2_097_152;
  value.engines = [{ id: pin.engine.id, version: 'fixture', imageDigest: pin.engine.imageDigest,
    configVersion: pin.engine.configVersion, installedIdentity: pin.installedIdentity, capabilities: ['http'] }];
  return value;
}
function protocol(reason: ProtocolError['reason'], attemptId: string): ProtocolError {
  return { protocolVersion: '1.0', organizationId: scope.organizationId, workspaceId: scope.workspaceId,
    attemptId, reason, retry: 'never', issues: [] };
}

/** Real TCP fake-agent receipt. It does not claim a real agent/engine execution. */
export async function deliveryHttpFixture(initial: RunProfilePin) {
  const events = eventHttpPeer();
  const state = { profile: initial, snapshots: true, losePut: false, puts: 0, gets: 0, caps: 0,
    accepted: 0, absences: 0, requireAbsence: false, receipt: undefined as AttemptSnapshot | undefined,
    original: undefined as Offer | undefined, bytes: undefined as string | undefined,
    failure: undefined as { error: unknown } | undefined };
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${loaded().token}`) throw new Error('Fixture authentication');
    if (request.url === '/runner/v1/capabilities') {
      getCapabilities(response); return;
    }
    const match = /^\/runner\/v1\/attempts\/([0-9a-f-]{36})(?:\/(events|ack)(?:\?after=[0-9]+)?)?$/.exec(request.url ?? '');
    if (!match) throw new Error('Unexpected fixture route');
    const attemptId = match[1]!;
    if (request.headers['x-beetle-journal-authority'] !== journalAuthority) {
      send(response, protocol('authority_mismatch', attemptId), 409); return;
    }
    const count = request.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === 'x-beetle-journal-authority').length;
    if (count !== 1) throw new Error('Fixture authority multiplicity');
    if (match[2]) { await eventRequest(request, response, attemptId); return; }
    if (request.method === 'GET') { getSnapshot(response, attemptId); return; }
    if (request.method !== 'PUT') throw new Error('Unexpected fixture method');
    await putOffer(request, response, attemptId);
  }
  async function eventRequest(request: IncomingMessage, response: ServerResponse, attemptId: string): Promise<void> {
    if (!state.original) { send(response, protocol('attempt_not_found', attemptId), 404); return; }
    await events.handle(request, response, state.original);
  }
  function getCapabilities(response: ServerResponse): void {
    if (++state.caps > 128) throw new Error('Fixture capability bound');
    send(response, frame(state.profile));
  }
  function getSnapshot(response: ServerResponse, attemptId: string): void {
    if (++state.gets > 128) throw new Error('Fixture snapshot bound');
    if (!state.snapshots) { response.writeHead(503); response.end(); return; }
    if (!state.receipt) { state.absences++; send(response, protocol('attempt_not_found', attemptId), 404); return; }
    send(response, state.receipt);
  }
  async function putOffer(request: IncomingMessage, response: ServerResponse, attemptId: string): Promise<void> {
    if (state.requireAbsence && state.absences === 0) throw new Error('Offer before scoped absence');
    if (++state.puts > 4) throw new Error('Fixture mutation bound');
    const text = await body(request); const checked = validate('Offer', JSON.parse(text) as unknown);
    if (!checked.ok || checked.value.attemptId !== attemptId) throw new Error('Invalid fixture Offer');
    if (state.original && state.bytes !== text) throw new Error('Changed original fixture bytes');
    if (!state.original) {
      state.original = checked.value; state.bytes = text; state.accepted++;
      const key = { runId: uuid(70), attempt: { organizationId: checked.value.organizationId,
        workspaceId: checked.value.workspaceId, attemptId, intentDigest: checked.value.intentDigest, generation: 1 as const } };
      state.receipt = snapshotFor(key);
    }
    if (state.losePut) { state.losePut = false; response.destroy(); return; }
    send(response, state.receipt, 202);
  }
  const server = await loopback((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      state.failure ??= { error }; if (!response.destroyed) { response.writeHead(500); response.end(); }
    });
  });
  return { state, events: events.state, close: server.close, connection: { ...server.loaded, configuration: {
    ...server.loaded.configuration, profiles: [initial], storageAllocationBytes: 2_000_000, freeSpaceReserveBytes: 2000 } } };
}
