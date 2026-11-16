import { expect, it, vi } from 'vitest';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import { originalIdentity, selector, setup } from '../runner/source-fixtures.js';
import { turns } from '../runner/fixtures.js';

function proof() {
  return captureOutputAbsence({ ...originalIdentity(), version: 1, finalAgentSeq: 0,
    admission: { state: 'released', disposition: 'never_started' }, reason: 'setup_failed' });
}
it('shares source and ordinary credit and retains aborted original until all native resources close', async () => {
  const { gateway, client, native } = setup(); const abort = new AbortController();
  const first = client.absence(abort.signal); const second = client.sourceChunk(selector(), 32);
  const ordinary = Array.from({ length: 6 }, () => gateway.attempt(originalIdentity()).snapshot());
  expect(await gateway.capabilities()).toEqual({ ok: false, error: { kind: 'transport' } });
  expect(await client.absence()).toEqual({ ok: false, error: { kind: 'transport' } });
  await turns(); const work = native.originals[0]!; work.begin(); abort.abort();
  work.request.emit('close'); work.response.emit('close');
  let settled = false; void first.then(() => { settled = true; }); await turns(); expect(settled).toBe(false);
  expect(await client.absence()).toEqual({ ok: false, error: { kind: 'transport' } });
  work.socket.emit('close'); expect(await first).toEqual({ ok: false, error: { kind: 'cancelled' } });
  const replacement = client.absence(); await turns(); expect(native.originals).toHaveLength(9);
  let closed = false; const closing = gateway.close().then(() => { closed = true; });
  const held = native.originals.at(-1)!; held.body(proof()); held.request.emit('close'); held.socket.emit('close');
  for (const original of native.originals.slice(1, -1)) original.close();
  await turns(); expect(closed).toBe(false);
  held.response.emit('close'); expect(await replacement).toEqual({ ok: true, value: proof() });
  await Promise.all([second, ...ordinary, closing]); expect(closed).toBe(true);
});

it.each(['length', 'stream'] as const)('bounds absence %s before oversized materialization', async mode => {
  const { client, native } = setup(); const pending = client.absence(); await turns(); const work = native.originals[0]!;
  if (mode === 'length') {
    work.response.headers['content-length'] = '2049'; work.response.rawHeaders.push('Content-Length', '2049');
  }
  const bytes = Buffer.alloc(2049, 32); const allocation = vi.spyOn(Buffer, 'allocUnsafe'); const parse = vi.spyOn(JSON, 'parse');
  work.begin();
  if (mode === 'length') expect(allocation).not.toHaveBeenCalled();
  else { expect(allocation).toHaveBeenCalledExactlyOnceWith(2048); work.response.emit('data', bytes); work.response.emit('end'); }
  expect(parse).not.toHaveBeenCalled(); expect(work.response.destroy).toHaveBeenCalled();
  work.close(); expect(await pending).toEqual({ ok: false, error: { kind: 'response' } });
});

it('accepts exact 2048 native byte limit with owned proof', async () => {
  const { client, native } = setup(); const pending = client.absence(); await turns(); const work = native.originals[0]!;
  const text = JSON.stringify(proof()); work.begin(); work.response.emit('data', Buffer.from(text + ' '.repeat(2048 - Buffer.byteLength(text))));
  work.response.emit('end'); work.close(); expect(await pending).toEqual({ ok: true, value: proof() });
});
