import { expect, it, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { eventHttpPeer } from './event-http-peer.js';
import { offer } from '../runner/fixtures.js';

function request(method: string, path: string) {
  const socket = new Socket(); const incoming = new IncomingMessage(socket);
  incoming.method = method; incoming.url = path;
  const response = new ServerResponse(incoming);
  return { incoming, response, close() { incoming.destroy(); response.destroy(); socket.destroy(); } };
}
it.each([
  ['GET', 'events'], ['GET', 'events?after=00'], ['GET', 'events?after=0&extra=1'],
  ['GET', 'ack'], ['POST', 'events?after=0'], ['DELETE', 'ack'],
])('rejects a routing regression %s %s', async (method, suffix) => {
  const peer = eventHttpPeer();
  const f = request(method, `/runner/v1/attempts/${offer().attemptId}/${suffix}`);
  try { await expect(peer.handle(f.incoming, f.response, offer())).rejects.toThrow(); }
  finally { f.close(); }
});
it.each(['GET', 'POST'])('rejects wrong-attempt %s before reading the body or calling the arrival oracle', async method => {
  const peer = eventHttpPeer(); const arrival = vi.fn(); peer.state.beforeAck = arrival;
  const suffix = method === 'GET' ? 'events?after=0' : 'ack';
  const f = request(method, `/runner/v1/attempts/00000000-0000-4000-8000-000000000099/${suffix}`);
  try { await expect(peer.handle(f.incoming, f.response, offer())).rejects.toThrow(); expect(arrival).not.toHaveBeenCalled(); }
  finally { f.close(); }
});
it('checks the independent commit oracle before waiting for any ACK body bytes', async () => {
  const peer = eventHttpPeer(); const arrival = vi.fn(() => { throw new Error('Commit absent at arrival'); });
  peer.state.beforeAck = arrival;
  const f = request('POST', `/runner/v1/attempts/${offer().attemptId}/ack`);
  try {
    // No bytes or EOF are supplied. An oracle queued behind body/metadata work
    // would stay pending rather than observing this failure at request arrival.
    await expect(peer.handle(f.incoming, f.response, offer())).rejects.toThrow('Commit absent at arrival');
    expect(arrival).toHaveBeenCalledTimes(1); expect(peer.state.acknowledged).toBe(0);
  } finally { f.close(); }
});
