import { expect, it, vi } from 'vitest';
import type { InputRecord } from '@beetle/contracts/api';
import { BrowserSessionGate } from './session.js';

const session = { scope: 'local-admin', csrfToken: 'c'.repeat(43), expiresAt: '2027-01-01T00:00:00.000Z' };
const record: InputRecord = { id: '00000000-0000-4000-8000-000000000001', version: 4,
  scope: { kind: 'workspace', organizationId: '00000000-0000-4000-8000-000000000002', workspaceId: '00000000-0000-4000-8000-000000000003' },
  folderId: '00000000-0000-4000-8000-000000000004', name: 'Synthetic input', bytes: 3, offset: 3,
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', state: 'published', reason: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function paired(gate: BrowserSessionGate) {
  await expect.poll(() => gate.getSnapshot().kind).toBe('paired');
  const state = gate.getSnapshot(); if (state.kind !== 'paired') throw new Error('Expected paired gate'); return state;
}

it('replaces a session only after a late byte fetch and its body cancellation drain', async () => {
  const reply = deferred<Response>(); const cancellation = deferred<void>(); let reads = 0; let byteSignal: AbortSignal | null | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/auth/session')) { reads++; return json(session); }
    byteSignal = init?.signal; return reply.promise;
  };
  const gate = new BrowserSessionGate({ baseUrl: 'http://localhost', fetch: fetcher }); gate.start();
  const first = await paired(gate);
  const download = first.transfers.download({ record });
  await expect.poll(() => byteSignal !== undefined).toBe(true);
  gate.check(); expect(byteSignal?.aborted).toBe(true);
  await expect.poll(() => reads).toBe(2); expect(gate.getSnapshot().kind).toBe('checking');
  const cancel = vi.fn(() => cancellation.promise);
  reply.resolve(new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: {
    'content-type': 'application/octet-stream', etag: `"${record.sha256}"` } }));
  await expect.poll(() => cancel.mock.calls.length).toBe(1);
  expect(gate.getSnapshot().kind).toBe('checking');
  cancellation.resolve(); expect(await download).toMatchObject({ ok: false, issued: true, error: { kind: 'cancelled' } });
  const next = await paired(gate); expect(next.transfers).not.toBe(first.transfers);
  expect(await first.transfers.download({ record })).toMatchObject({ ok: false, issued: false, error: { kind: 'closed' } });
  const prepared = await next.transfers.prepare({ file: new Blob(['abc']) });
  expect(prepared).toMatchObject({ ok: true, value: { sha256: record.sha256 } });
  gate.stop(); await next.transfers.close();
});

it('a byte-route 401 retires session authority and the byte client owns the response cleanup', async () => {
  const cancel = vi.fn();
  const fetcher: typeof fetch = async input => String(input).endsWith('/auth/session') ? json(session)
    : new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 401 });
  const gate = new BrowserSessionGate({ baseUrl: 'http://localhost', fetch: fetcher }); gate.start();
  const first = await paired(gate); const result = await first.transfers.download({ record });
  expect(result).toMatchObject({ ok: false, issued: true, error: { kind: 'cancelled' } });
  expect(gate.getSnapshot().kind).toBe('unpaired'); expect(cancel).toHaveBeenCalledTimes(1);
  gate.stop(); await first.transfers.close();
});

it('failed cleanup cannot silently open a replacement transfer session', async () => {
  const reply = deferred<Response>();
  const gate = new BrowserSessionGate({ baseUrl: 'http://localhost', fetch: async input =>
    String(input).endsWith('/auth/session') ? json(session) : reply.promise });
  gate.start(); const first = await paired(gate); const download = first.transfers.download({ record });
  gate.check();
  reply.resolve(new Response(new ReadableStream<Uint8Array>({ cancel: () => Promise.reject(new Error('PRIVATE_CANARY')) })));
  expect(await download).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
  await expect.poll(() => gate.getSnapshot().kind).toBe('unavailable');
  expect(JSON.stringify(gate.getSnapshot())).not.toContain('PRIVATE_CANARY');
  gate.stop(); await expect(first.transfers.close()).rejects.toThrow('Input transfer cleanup failed');
});

it('a reentrant checking subscriber cannot make two reads adopt one current epoch', async () => {
  const replies: ReturnType<typeof deferred<Response>>[] = [];
  const gate = new BrowserSessionGate({ baseUrl: 'http://localhost', fetch: async () => {
    const reply = deferred<Response>(); replies.push(reply); return reply.promise;
  } });
  let nested = false;
  gate.subscribe(() => { if (!nested && gate.getSnapshot().kind === 'checking') { nested = true; gate.check(); } });
  try {
    gate.start(); await turn();
    expect(replies).toHaveLength(1);
    replies[0]!.resolve(json(session)); const state = await paired(gate);
    gate.stop(); await state.transfers.close();
  } finally {
    gate.stop(); for (const reply of replies) reply.resolve(json(session));
    await turn();
  }
});

it('an abort callback can reenter check without leaving an orphan session read', async () => {
  const reply = deferred<Response>(); let reads = 0; let nested = false;
  const gate = new BrowserSessionGate({ baseUrl: 'http://localhost', fetch: async (input, init) => {
    if (String(input).endsWith('/auth/session')) { reads++; return json(session); }
    init?.signal?.addEventListener('abort', () => { if (!nested) { nested = true; gate.check(); } }, { once: true });
    return reply.promise;
  } });
  gate.start(); const first = await paired(gate); const download = first.transfers.download({ record });
  try {
    gate.check(); await turn();
    expect(reads).toBe(2); expect(gate.getSnapshot().kind).toBe('checking');
    reply.resolve(new Response(null)); await download;
    const next = await paired(gate); gate.stop(); await next.transfers.close();
  } finally { gate.stop(); reply.resolve(new Response(null)); await download; await first.transfers.close(); }
});
