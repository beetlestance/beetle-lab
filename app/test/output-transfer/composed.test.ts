import { expect, it } from 'vitest';
import { createOutputTransfers } from '../../src/application/output-transfer/index.js';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import type { OutputTransferOptions } from '../../src/ports/output-transfer.js';
import { OutputByteError } from '../../src/ports/output-bytes.js';
import type { OutputFileJob, OutputFileRecord } from '../../src/ports/output-bytes.js';
import { storageFixture } from '../storage/fixture.js';
import { nativeFixture } from './native-fixture.js';
import { binary, descriptor, peer, seeded, sha } from './peer-fixture.js';
import { id } from './controlled-fixture.js';

const storage = storageFixture();
async function finish<T>(job: OutputFileJob<T>): Promise<T> {const result = await job.result; await job.settled; return result;}
it('composes compiled MetadataWorker, native bytes and actual TCP gateway for independent binary and empty files', async () => {
  const bytes = binary(); const empty = Buffer.alloc(0); const f = seeded([descriptor(bytes), descriptor(empty, 1)]);
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path); f.db.close();
  const metadata = await storage.open(path, {runs: f.config}); const files = await nativeFixture();
  const source = await peer(f.envelope, [bytes, empty]); const gateway = createRunnerGateway(source.loaded);
  const service = createOutputTransfers({metadata: metadata.outputs, files: files.store, gateway,
    freeSpaceReserveBytes: 0, newWriterId: () => id(800)});
  try {
    const job = service.transfer(f.binding); await expect(job.result).resolves.toEqual({kind: 'published', binding: f.binding,
      manifestDigest: f.envelope.manifest.manifestDigest, sourceDigest: f.envelope.sourceDigest}); await job.settled;
    const state = await metadata.outputs.load(f.binding); if (state.kind !== 'adopted') throw new Error('Source not adopted');
    expect(state.artifacts.map(a => [a.phase, a.writer, a.offset])).toEqual([['published', null, 131089], ['published', null, 0]]);
    for (const [ordinal, expected] of [bytes, empty].entries()) {
      const received: Buffer[] = []; const record: OutputFileRecord = {binding: f.binding, artifact: state.artifacts[ordinal]!};
      await finish(files.store.read({record, start: 0, endExclusive: expected.length, sink: {async write(chunk) {received.push(Buffer.from(chunk));}}},
        {deadline: performance.now() + 5000, freeSpaceReserveBytes: 0}));
      expect(Buffer.concat(received)).toEqual(expected); expect(sha(Buffer.concat(received))).toBe(sha(expected));
    }
    expect(source.selectors.map(s => [s.offset, s.length])).toEqual([[0, 65536], [65536, 65536], [131072, 17]]);
    expect(source.unexpected).toEqual([]);
  } finally {await service.close(); await gateway.close(); await storage.close(metadata); await source.close(); await files.dispose();}
});
it.each(['progress', 'publication', 'native-publication'] as const)('recovers exact durable writer/token after lost %s response and reopening real owners', async fault => {
  const bytes = binary(); const f = seeded([descriptor(bytes)]); const path = storage.path();
  f.db.prepare('VACUUM INTO ?').run(path); f.db.close();
  let metadata = await storage.open(path, {runs: f.config}); const files = await nativeFixture();
  const source = await peer(f.envelope, [bytes]); const gateway = createRunnerGateway(source.loaded);
  let discarded = false; let writerCalls = 0;
  const options = (): OutputTransferOptions => ({metadata: {...metadata.outputs,
    recordProgress: async request => {
      const value = await metadata.outputs.recordProgress(request);
      if (fault === 'progress' && !discarded && value.artifact.offset > 0) {discarded = true; throw new Error('Synthetic lost committed response');}
      return value;
    },
    recordPublication: async request => {
      const value = await metadata.outputs.recordPublication(request);
      if (fault === 'publication' && !discarded) {discarded = true; throw new Error('Synthetic lost committed response');}
      return value;
    }}, files: files.store, gateway, freeSpaceReserveBytes: 0, newWriterId: () => {writerCalls++; return id(800);}});
  const firstOptions: OutputTransferOptions = {...options(), files: fault === 'native-publication' ? {prepare: (r, c) => files.store.prepare(r, c),
    append: (r, c) => files.store.append(r, c), publish: (r, c) => {
      const original = files.store.publish(r, c); return {...original, result: original.result.then(() => {discarded = true; throw new OutputByteError('io');})};
    }} : files.store};
  let service = createOutputTransfers(firstOptions);
  try {
    const failed = service.transfer(f.binding); await expect(failed.result).rejects.toMatchObject({code: 'storage'}); await failed.settled;
    expect(discarded).toBe(true);
    const before = await metadata.outputs.load(f.binding); if (before.kind !== 'adopted') throw new Error('Missing retained source');
    const old = before.artifacts[0]!; expect(old.token).toMatch(/^[a-f0-9-]{36}$/);
    if (fault !== 'publication') expect(old.writer).toBe(id(800)); else expect(old.writer).toBe(null);
    const oldSelectors = source.selectors.length;
    await service.close(); await storage.close(metadata); await files.reopen(); metadata = await storage.open(path, {runs: f.config});
    service = createOutputTransfers(options()); await expect(service.transfer(f.binding).result).resolves.toMatchObject({kind: 'published'});
    const after = await metadata.outputs.load(f.binding); if (after.kind !== 'adopted') throw new Error('Missing published source');
    expect(after.artifacts[0]).toMatchObject({token: old.token, phase: 'published', writer: null, offset: bytes.length});
    expect(writerCalls).toBe(1); if (fault !== 'progress') expect(source.selectors).toHaveLength(oldSelectors);
    expect(source.unexpected).toEqual([]);
  } finally {await service.close(); await gateway.close(); await storage.close(metadata); await source.close(); await files.dispose();}
});
it('publishes an actual adopted zero-artifact source without file operations or target calls', async () => {
  const f = seeded([]); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path); f.db.close();
  const metadata = await storage.open(path, {runs: f.config}); const files = await nativeFixture();
  const source = await peer(f.envelope, []); const gateway = createRunnerGateway(source.loaded);
  let writerCalls = 0; const service = createOutputTransfers({metadata: metadata.outputs, files: files.store, gateway,
    freeSpaceReserveBytes: 0, newWriterId: () => {writerCalls++; return id(800);}});
  try {
    await expect(service.transfer(f.binding).result).resolves.toMatchObject({kind: 'published'});
    expect(await metadata.outputs.load(f.binding)).toMatchObject({kind: 'adopted', artifacts: []});
    expect(writerCalls).toBe(0); expect(source.selectors).toEqual([]); expect(source.unexpected).toEqual([]);
  } finally {await service.close(); await gateway.close(); await storage.close(metadata); await source.close(); await files.dispose();}
});
