import { afterEach, beforeEach } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import { createControlReader } from '../../src/collection/control/index.js';
import type { ControlReader, ControlReadValue } from '../../src/collection/control/index.js';
import type { WrapperBatch, WrapperCheckpoint } from '../../src/control-protocol/index.js';
import { nodePorts } from '../../src/collection/control/ports.js';
import type { ReaderPorts } from '../../src/collection/control/ports.js';
import { Reader } from '../../src/collection/control/reader.js';

export async function value(reader: ControlReader, stopped = false): Promise<ControlReadValue> {
  const operation = reader.read({ deadline: performance.now() + 5000, stopped });
  const result = await operation.result; await operation.quiesced;
  if (!result.ok) throw new Error(`Unexpected failure ${result.reason}`);
  return result.value;
}
export function ack(batch: Readonly<WrapperBatch>): Readonly<WrapperCheckpoint> {
  return { ...batch.next, lastBatchDigest: createHash('sha256').update(JSON.stringify(batch)).digest('hex') };
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function largeFrame(event: ControlEvent, length = 65_535): Promise<ControlEvent> {
  const payload = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  payload.artifacts = Array.from({ length: 100 }, () => ({ artifactId: event.attemptId, kind: 'report',
    relativePath: 'a'.repeat(500), bytes: 1, sha256: 'a'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' }));
  const result = { ...event, kind: 'engine.result', payload } as ControlEvent;
  let excess = Buffer.byteLength(JSON.stringify(result)) - length;
  for (const artifact of payload.artifacts) {
    const remove = Math.min(excess, artifact.relativePath.length - 1);
    artifact.relativePath = artifact.relativePath.slice(remove); excess -= remove;
  }
  if (excess !== 0) throw new Error('fixture length unavailable');
  return result;
}
export function tracking(chunk = 65_536) {
  const reads: { position: number; bytes: number }[] = []; let closes = 0; let opens = 0;
  const ports: ReaderPorts = { ...nodePorts, open: async (...args) => {
    opens++; const handle = await nodePorts.open(...args);
    return new Proxy(handle, { get(target, property) {
      if (property === 'read') return async (...readArgs: unknown[]) => {
        readArgs[2] = Math.min(Number(readArgs[2]), chunk);
        const result: { bytesRead: number } = await Reflect.apply(target.read, target, readArgs);
        reads.push({ position: Number(readArgs[3]), bytes: result.bytesRead }); return result;
      };
      if (property === 'close') return async () => { closes++; await target.close(); };
      const field: unknown = Reflect.get(target, property);
      return typeof field === 'function' ? field.bind(target) : field;
    } });
  } };
  return { ports, reads, closes: () => closes, opens: () => opens };
}
export function fixture() {
  let directory = ''; let event: ControlEvent;
  const readers: ControlReader[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'beetle-control-reader-')); await chmod(directory, 0o700);
    event = JSON.parse(await readFile('contracts/fixtures/valid/wrapper-progress.json', 'utf8')) as ControlEvent;
  });
  afterEach(async () => {
    await Promise.allSettled(readers.splice(0).map(reader => reader.close()));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory: () => directory, path: () => join(directory, 'control.ndjson'),
    event: (seq = 1): ControlEvent => ({ ...structuredClone(event), seq }),
    key: () => ({ organizationId: event.organizationId, workspaceId: event.workspaceId,
      attemptId: event.attemptId, generation: event.generation }),
    async write(bytes: string | Buffer): Promise<void> {
      await writeFile(join(directory, 'control.ndjson'), bytes, { mode: 0o600 });
    },
    reader(checkpoint: Readonly<WrapperCheckpoint> | null = null, ports?: ReaderPorts): ControlReader {
      const options = { directory, uid: process.getuid!(), key: this.key(), checkpoint };
      const reader = ports ? new Reader(options, ports) : createControlReader(options);
      readers.push(reader); return reader;
    },
  };
}
