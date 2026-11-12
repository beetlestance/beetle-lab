import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { hashArtifactFile } from '../../wrapper/artifact-custody/index.js';
function deferred() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve=done;}); return {promise,resolve};}
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
it('hashes large and empty inputs with one64KiB buffer, positional bounded calls and an EOF probe', async () => {
  for (const size of [0,3 * 1048576 + 17]) {
    const bytes = Buffer.alloc(size,83); const buffers = new Set<Uint8Array>(); let calls=0; let checks=0;
    const actual = await hashArtifactFile({bytes:size,maximumBytes:4 * 1048576,check() {checks++;},file:{async read(buffer,offset,length,position) {
      calls++; buffers.add(buffer); expect(buffer.byteLength).toBe(65536); expect(offset).toBe(0); expect(length).toBeLessThanOrEqual(65536);
      const value = bytes.subarray(position,position+length); buffer.set(value); return {bytesRead:value.length};
    }}});
    expect(actual).toBe(hash(bytes)); expect(buffers.size).toBe(1); expect(calls).toBe(Math.ceil(size/65536)+1); expect(checks).toBeGreaterThanOrEqual(calls*2);
  }
});
it('rejects invalid allowances before IO and bounds arbitrarily short progress', async () => {
  let reads=0;
  const file = {async read() {reads++; return {bytesRead:1};}};
  for (const bytes of [-1,-0,NaN,Infinity,257 * 1048576]) await expect(hashArtifactFile({file,bytes,maximumBytes:256 * 1048576,check() {}})).rejects.toMatchObject({reason:'artifact'});
  expect(reads).toBe(0);
  await expect(hashArtifactFile({file,bytes:65536,maximumBytes:65536,check() {}})).rejects.toMatchObject({reason:'artifact'}); expect(reads).toBe(33);
});
it.each([0,-1,NaN,Infinity,65537])('refuses invalid nonterminal read count %s', async bytesRead => {
  await expect(hashArtifactFile({bytes:65536,maximumBytes:65536,check() {},file:{async read() {return {bytesRead};}}})).rejects.toMatchObject({reason:'artifact'});
});
it('rejects non-EOF and retains an issued read across cancellation until its original settles', async () => {
  await expect(hashArtifactFile({bytes:0,maximumBytes:1,check() {},file:{async read() {return {bytesRead:1};}}})).rejects.toMatchObject({reason:'artifact'});
  const hold=deferred(); let entered=false; let cancelled=false; let complete=false;
  const original=hashArtifactFile({bytes:1,maximumBytes:1,check() {if (cancelled) throw new Error('cancelled');},file:{async read(buffer) {entered=true; await hold.promise; buffer[0]=1; return {bytesRead:1};}}});
  void original.then(() => {complete=true;}, () => {complete=true;}); await new Promise<void>(resolve => setImmediate(resolve)); expect(entered).toBe(true);
  cancelled=true; await new Promise<void>(resolve => setImmediate(resolve)); expect(complete).toBe(false); hold.resolve(); await expect(original).rejects.toThrow('cancelled');
});
