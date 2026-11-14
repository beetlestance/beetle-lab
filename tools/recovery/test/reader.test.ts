import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { archiveFixture } from './archive-fixture.js';
import { restoreHistory } from '../src/restore.js';
import { readClaim } from '../src/claim.js';
import { attest } from '../src/attestation.js';
import { RecoveryIO } from '../src/io.js';
import { HistoryReader } from '../src/viewer/reader.js';
const operation = () => ({signal: new AbortController().signal, deadline: performance.now() + 10000});
async function fixture() {
  const f = await archiveFixture(); const destination = join(f.root, 'history');
  await restoreHistory({archive: f.destination, destination, operationId: randomUUID(), limits: {...f.bounds, maximumBytes: 2097152}, operation: operation()});
  const io = new RecoveryIO(operation());
  try {
    const claim = await readClaim(io, destination); const proof = await attest(io, claim, f.result.entries);
    const reader = new HistoryReader(claim, f.result.header, f.result.entries, proof);
    const files = f.result.entries.filter(entry => entry.kind === 'file'); return {reader, files};
  } finally {await io.closeAll();}
}
it('streams only the requested verified range in bounded chunks', async () => {
  const {reader, files} = await fixture(); const file = files[0]!; const chunks: Uint8Array[] = [];
  try {
    const job = reader.read({...file, start: 1, endExclusive: 70001, sink: {write: async bytes => {expect(bytes.length).toBeLessThanOrEqual(65536); chunks.push(bytes);}}}, operation());
    await job.result; await job.settled; const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBe(70000); expect(bytes.every(value => value === 13)).toBe(true);
    expect(() => reader.read({...file, start: 0, endExclusive: file.bytes + 1, sink: {write: async () => {}}}, operation())).toThrow();
  } finally {await reader.close();}
});
it('keeps shared credits until original consumer backpressure and native cleanup actually drain', async () => {
  const {reader, files} = await fixture(); let release!: () => void; let entered!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;}); const writing = new Promise<void>(resolve => {entered = resolve;});
  const sink = {write: async () => {entered(); await held;}}; const controller = new AbortController();
  const first = reader.read({...files[0]!, start: 0, endExclusive: files[0]!.bytes, sink}, {...operation(), signal: controller.signal});
  const second = reader.read({...files[1]!, start: 0, endExclusive: files[1]!.bytes, sink}, operation());
  await writing; controller.abort(); let drained = false; void first.settled.then(() => {drained = true;});
  expect(drained).toBe(false);
  expect(() => reader.read({...files[2]!, start: 0, endExclusive: 1, sink}, operation())).toThrow();
  const closing = reader.close(); expect(reader.close()).toBe(closing); release();
  await expect(first.result).rejects.toThrow('cancelled'); await second.result; await first.settled; await closing; expect(drained).toBe(true);
});
