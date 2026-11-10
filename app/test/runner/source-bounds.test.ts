import { expect, it, vi } from 'vitest';
import { SOURCE_ENVELOPE_BYTES, SOURCE_CHUNK_BYTES } from '@beetle/contracts/output-source';
import type { SourceChunk } from '@beetle/contracts/output-source';
import { originalIdentity, envelope, selector, chunk, setup } from './source-fixtures.js';
import { turns } from './fixtures.js';

it.each(['source', 'chunk'] as const)('enforces %s Content-Length before buffer allocation or JSON parse', async operation => {
  const { client, native } = setup(); const cap = operation === 'source' ? SOURCE_ENVELOPE_BYTES : SOURCE_CHUNK_BYTES;
  const pending = operation === 'source' ? client.source() : client.sourceChunk(selector(), 32); await turns();
  const work = native.originals[0]!; work.response.headers['content-length'] = String(cap + 1);
  work.response.rawHeaders.push('Content-Length', String(cap + 1));
  const allocation = vi.spyOn(Buffer, 'allocUnsafe'); const parse = vi.spyOn(JSON, 'parse'); work.begin();
  expect(allocation).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled(); expect(work.response.destroy).toHaveBeenCalled();
  work.close(); expect(await pending).toEqual({ ok: false, error: { kind: 'response' } });
});

it.each(['source', 'chunk'] as const)('bounds streamed %s bytes before copy and JSON parse', async operation => {
  const { client, native } = setup(); const cap = operation === 'source' ? SOURCE_ENVELOPE_BYTES : SOURCE_CHUNK_BYTES;
  const pending = operation === 'source' ? client.source() : client.sourceChunk(selector(), 32); await turns();
  const work = native.originals[0]!; const oversized = Buffer.alloc(cap + 1, 32);
  const allocation = vi.spyOn(Buffer, 'allocUnsafe'); const parse = vi.spyOn(JSON, 'parse'); work.begin();
  expect(allocation).toHaveBeenCalledExactlyOnceWith(cap);
  work.response.emit('data', oversized); work.response.emit('end'); expect(parse).not.toHaveBeenCalled();
  expect(work.response.destroy).toHaveBeenCalled(); work.close(); expect(await pending).toEqual({ ok: false, error: { kind: 'response' } });
});

it.each(['source', 'chunk'] as const)('accepts exact native %s byte cap with valid semantic data', async operation => {
  const { client, native } = setup(); const cap = operation === 'source' ? SOURCE_ENVELOPE_BYTES : SOURCE_CHUNK_BYTES;
  const value = operation === 'source' ? envelope() : chunk(); const text = JSON.stringify(value);
  const body = Buffer.from(text + ' '.repeat(cap - Buffer.byteLength(text)));
  const pending = operation === 'source' ? client.source() : client.sourceChunk(selector(), 32); await turns();
  const work = native.originals[0]!; work.response.headers['content-length'] = String(cap);
  work.response.rawHeaders.push('Content-Length', String(cap)); work.begin(); work.response.emit('data', body); work.response.emit('end'); work.close();
  expect(await pending).toEqual({ ok: true, value });
});

it('refuses oversized requests and getter input before native effects, without invoking the getter', async () => {
  const { client, native } = setup(); const get = vi.fn(() => 0);
  expect(await client.sourceChunk(Object.defineProperty(selector(), 'offset', { get }), 32)).toMatchObject({ ok: false, error: { kind: 'request' } });
  expect(get).not.toHaveBeenCalled();
  const oversized = { ...selector(), padding: 'x'.repeat(1024) };
  expect(await client.sourceChunk(oversized, 32)).toMatchObject({ ok: false, error: { kind: 'request' } });
  expect(native.io.lookup).not.toHaveBeenCalled(); expect(native.io.request).not.toHaveBeenCalled();
});

it.each([-1, NaN, Number.MAX_SAFE_INTEGER + 1, 0.5])('refuses unsafe declared artifact bytes %s before I/O', async bytes => {
  const { client, native } = setup(); expect(await client.sourceChunk(selector(), bytes)).toMatchObject({ ok: false, error: { kind: 'request' } });
  expect(native.io.lookup).not.toHaveBeenCalled();
});

it('refuses unsupported generation and beyond-end requests before I/O', async () => {
  const { gateway, client, native } = setup(); const later = gateway.output({ ...originalIdentity(), generation: 2 });
  expect(await later.source()).toMatchObject({ ok: false, error: { kind: 'request' } });
  expect(await later.sourceChunk(selector(), 32)).toMatchObject({ ok: false, error: { kind: 'request' } });
  expect(await client.sourceChunk(selector(33), 32)).toMatchObject({ ok: false, error: { kind: 'request' } });
  expect(native.io.lookup).not.toHaveBeenCalled();
});

it.each([0, 32, Number.MAX_SAFE_INTEGER])('accepts explicit empty EOF at safe declared end %s', async bytes => {
  const { client, native } = setup(); const expected = selector(bytes);
  const pending = client.sourceChunk(expected, bytes); await turns(); const work = native.originals[0]!;
  const value = chunk(Buffer.alloc(0), expected, bytes); work.body(value); work.close(); expect(await pending).toEqual({ ok: true, value });
});

const wrongChunks: Record<string, (value: SourceChunk) => void> = {
  manifest: value => { value.manifestDigest = 'f'.repeat(64); }, source: value => { value.sourceDigest = 'f'.repeat(64); },
  artifact: value => { value.artifactId = originalIdentity().attemptId; }, offset: value => { value.offset = 1; },
  next: value => { value.nextOffset++; }, total: value => { value.totalBytes++; }, eof: value => { value.eof = false; },
  base64: value => { value.base64 = 'AB=='; }, count: value => { value.base64 = Buffer.alloc(31).toString('base64'); },
};
it.each(Object.entries(wrongChunks))('uses shared chunk verification to reject %s', async (_, change) => {
  const { client, native } = setup(); const value = chunk(); change(value);
  const pending = client.sourceChunk(selector(), 32); await turns(); const work = native.originals[0]!; work.body(value); work.close();
  expect(await pending).toEqual({ ok: false, error: { kind: 'response', status: 200 } });
});
