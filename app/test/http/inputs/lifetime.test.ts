import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequestContext } from '../../../src/adapters/inbound/http/inputs/context.js';
import { RequestLifetimes } from '../../../src/adapters/inbound/http/inputs/lifetime.js';
import { noQuery } from '../../../src/adapters/inbound/http/inputs/validation.js';
import { createApiServer } from '../../../src/adapters/inbound/http/api-errors.js';
import { writeContent } from '../../../src/adapters/inbound/http/inputs/response.js';
import { deferred, turn } from './fixture.js';

function context(complete = true) {
  const raw = Object.assign(new PassThrough(), { complete });
  const events = new EventEmitter();
  const response = Object.assign(events, { writableFinished: false, destroy: () => events.emit('close') });
  const retire = vi.fn();
  const owner = new RequestContext({ raw } as unknown as FastifyRequest,
    { raw: response } as unknown as FastifyReply, retire);
  return { owner, raw, response, retire };
}
it('does not cancel completed body close and retains an original after the response ends', async () => {
  const { owner, raw, retire } = context(); const original = deferred<string>();
  const result = owner.run(() => original.promise); raw.emit('close');
  expect(owner.signal.aborted).toBe(false); owner.finish();
  expect(retire).not.toHaveBeenCalled(); expect(owner.originals.size).toBe(1);
  original.resolve('done'); expect(await result).toBe('done'); await owner.drain();
  expect(retire).toHaveBeenCalledTimes(1);
});
it('disconnect fences future issue while close continues to retain a held metadata original', async () => {
  const { owner, response, retire } = context(); const original = deferred<void>();
  const work = owner.run(() => original.promise); const observed = work.catch(error => error);
  response.emit('close'); expect((await observed).code).toBe('storage_unavailable');
  const issue = vi.fn(); await expect(owner.run(issue)).rejects.toMatchObject({ code: 'storage_unavailable' });
  expect(issue).not.toHaveBeenCalled(); expect(retire).not.toHaveBeenCalled();
  let drained = false; const drain = owner.drain().then(() => { drained = true; });
  await turn(); expect(drained).toBe(false); original.resolve(); await drain;
  expect(retire).toHaveBeenCalledTimes(1);
});
it('captures exactly one 30s deadline and does not release an original on expiration', async () => {
  vi.useFakeTimers();
  try {
    const { owner, retire } = context(); const original = deferred<void>();
    const result = owner.run(() => original.promise).catch(error => error); owner.finish();
    await vi.advanceTimersByTimeAsync(29_999); expect(owner.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect((await result).code).toBe('storage_unavailable');
    expect(retire).not.toHaveBeenCalled(); original.resolve(); await owner.drain();
    expect(retire).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
it('awaits original write callback AND backpressure and rejects aborted writes', async () => {
  const response = new EventEmitter(); let callback!: (error?: Error) => void;
  Object.assign(response, { destroyed: false, write: vi.fn((_chunk, done) => { callback = done; return false; }) });
  const reply = { raw: response } as unknown as FastifyReply; const ac = new AbortController();
  let done = false; const write = writeContent(reply, Buffer.from('abc'), ac.signal).then(() => { done = true; });
  callback(); await turn(); expect(done).toBe(false); response.emit('drain'); await write; expect(done).toBe(true);
  const second = writeContent(reply, Buffer.from('abc'), ac.signal);
  let settled = false; void second.then(() => { settled = true; }, () => { settled = true; });
  ac.abort(); await turn(); expect(settled).toBe(false);
  callback(); await expect(second).rejects.toMatchObject({ code: 'storage_unavailable' });
  expect(response.listenerCount('drain')).toBe(0);
});

it('bounds transport contexts at 64 without waiting and retires parser failures exactly once', async () => {
  const server = createApiServer(); const owners = new RequestLifetimes(); owners.register(server);
  const release = deferred<void>(); const allIssued = deferred<void>(); let issued = 0;
  server.post('/parse', async () => ({ ok: true }));
  server.get('/hold', async request => owners.forRequest(request).run(async () => {
    if (++issued === 64) allIssued.resolve(); await release.promise; return { ok: true };
  }));
  const held: Promise<unknown>[] = [];
  try {
    for (let i = 0; i < 80; i++) {
      const invalid = await server.inject({ method: 'POST', url: '/parse', headers: { 'content-type': 'application/json' }, payload: '{' });
      expect(invalid.statusCode).toBe(400);
    }
    for (let i = 0; i < 64; i++) held.push(server.inject({ url: '/hold' }));
    await allIssued.promise;
    const excess = await server.inject({ url: '/hold' }); expect(excess.statusCode).toBe(503); expect(issued).toBe(64);
    release.resolve(); await Promise.all(held);
    expect((await server.inject({ url: '/hold' })).statusCode).toBe(200); expect(issued).toBe(65);
  } finally { release.resolve(); await Promise.allSettled(held); await owners.close(); await server.close(); }
});

it('rejects a literal empty query marker before service issue (injection normalizes this marker away)', () => {
  expect(() => noQuery({ raw: { url: '/content?' } } as FastifyRequest)).toThrow();
});
