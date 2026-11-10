import { afterEach } from 'vitest';
import type { AckReceipt } from '@beetle/contracts';
import { validate } from '@beetle/contracts';
import type { Journal } from '../../../agent/src/journal/index.js';
import { createAgentServer } from '../../../agent/src/transport/index.js';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { loaded } from '../runner/fixtures.js';

const credential = 'S'.repeat(64);
/** Real HTTP/Journal services; hooks only observe traffic or drop a completed ACK response. */
export function agentHttpFixture() {
  const handles = new Set<{ close(): Promise<void> }>();
  afterEach(async () => { await Promise.all([...handles].map(handle => handle.close())); });
  return async (journal: Journal) => {
    const authority = await journal.journalAuthority();
    const unexpected = async (): Promise<never> => { throw new Error('Unexpected installation/execution call'); };
    const server = createAgentServer({ credential, journalAuthority: authority, journal,
      installation: { enqueue: unexpected, cancel: unexpected, cancelOriginal: unexpected }, capabilities: unexpected });
    const state = { requests: [] as string[], receipts: [] as AckReceipt[], statuses: [] as number[], loseAck: false,
      beforeAck: undefined as (() => void) | undefined };
    server.addHook('onRequest', async request => {
      if (state.requests.length >= 16) throw new Error('Agent seam request bound');
      state.requests.push(`${request.method} ${request.url}`);
      if (request.url.endsWith('/ack')) state.beforeAck?.();
    });
    server.addHook('onSend', async (request, reply, payload) => {
      state.statuses.push(reply.statusCode);
      if (!request.url.endsWith('/ack') || reply.statusCode !== 200) return payload;
      if (typeof payload !== 'string' || Buffer.byteLength(payload) > 4096) throw new Error('ACK response bound');
      const receipt = validate('AckReceipt', JSON.parse(payload) as unknown);
      if (!receipt.ok || state.receipts.length >= 8) throw new Error('Invalid actual ACK receipt');
      state.receipts.push(receipt.value);
      if (state.loseAck) { state.loseAck = false; reply.raw.destroy(); }
      return payload;
    });
    const connection: { gateway?: ReturnType<typeof createRunnerGateway> } = {};
    const handle = { async close() {
      await connection.gateway?.close(); await server.close(); handles.delete(handle);
    } };
    handles.add(handle);
    const origin = await server.listen({ host: '127.0.0.1', port: 0 });
    const gateway = createRunnerGateway({ ...loaded(origin), token: credential });
    connection.gateway = gateway;
    return { server, gateway, authority, state, close: handle.close };
  };
}
