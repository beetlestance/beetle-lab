import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventBatch, Offer } from '@beetle/contracts';
import { validate } from '@beetle/contracts';
import { send } from '../runner/fixtures.js';
import template from '../../../contracts/fixtures/valid/events.json' with { type: 'json' };

async function body(request: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk) || Buffer.byteLength(text) + chunk.length > 4096) throw new Error('Synthetic ACK bound');
    text += chunk.toString('utf8');
  }
  return text;
}
/** Bounded synthetic journal peer; no real agent or engine execution is inferred. */
export function eventHttpPeer() {
  const state = { count: 0, gets: 0, acks: 0, acknowledged: 0, loseAck: false, afters: [] as number[],
    beforeAck: undefined as (() => void) | undefined };
  function readEvents(request: IncomingMessage, response: ServerResponse, original: Offer): void {
    const scope = { organizationId: original.organizationId, workspaceId: original.workspaceId,
      attemptId: original.attemptId, generation: 1 as const };
    const url = new URL(request.url!, 'http://fixture.invalid');
    const afterText = url.searchParams.get('after');
    const after = Number(afterText);
    if (afterText === null || String(after) !== afterText || request.url !== `/runner/v1/attempts/${original.attemptId}/events?after=${after}`) throw new Error('Unexpected synthetic event route');
    if (++state.gets > 16 || !Number.isSafeInteger(after) || after < state.acknowledged
      || after > state.count || state.count > 2) throw new Error('Unexpected synthetic event read');
    state.afters.push(after);
    const events = Array.from({ length: state.count - after }, (_, index) => ({
      ...structuredClone(template.events[0]!) as EventBatch['events'][number], ...scope, seq: after + index + 1,
    }));
    send(response, { protocolVersion: '1.0', ...scope, events, nextCursor: state.count,
      retainedStartSeq: state.acknowledged + 1 });
  }
  async function acknowledge(request: IncomingMessage, response: ServerResponse, original: Offer): Promise<void> {
    const scope = { organizationId: original.organizationId, workspaceId: original.workspaceId, attemptId: original.attemptId, generation: 1 as const };
    if (request.url !== `/runner/v1/attempts/${original.attemptId}/ack` || request.method !== 'POST' || ++state.acks > 8) throw new Error('Unexpected synthetic event mutation');
    // Synchronous arrival oracle must precede body reads and their asynchronous turns.
    state.beforeAck?.();
    const text = await body(request);
    const ack = validate('Ack', JSON.parse(text) as unknown);
    if (!ack.ok || !Object.entries(scope).every(([key, value]) => Reflect.get(ack.value, key) === value)
      || ack.value.throughSeq > state.count || ack.value.throughSeq < state.acknowledged) throw new Error('Invalid synthetic ACK');
    state.acknowledged = ack.value.throughSeq;
    if (state.loseAck) { state.loseAck = false; response.destroy(); return; }
    send(response, { protocolVersion: '1.0', ...scope, acknowledgedSeq: state.acknowledged });
  }
  async function handle(request: IncomingMessage, response: ServerResponse, original: Offer): Promise<void> {
    if (request.method === 'GET') return readEvents(request, response, original);
    return acknowledge(request, response, original);
  }
  return { state, handle };
}
