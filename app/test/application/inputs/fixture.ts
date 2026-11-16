import { createHash } from 'node:crypto';
import { InputByteError } from '../../../src/ports/input-bytes.js';
import type { InputByteStore, InputByteJob } from '../../../src/ports/input-bytes.js';
import type { InputControl, InputRecord, InputStore } from '../../../src/ports/inputs.js';
import { createInputService } from '../../../src/application/inputs/index.js';
import { digest, scope, uuid, requestId, seed } from '../../storage/fixture.js';
import type { storageFixture } from '../../storage/fixture.js';
import { inputOptions } from '../../storage/inputs-fixture.js';
export { scope, uuid, requestId, digest };
export const key = (record: InputRecord) => ({ id: record.id, scope: record.scope });
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const turn = () => new Promise<void>(resolve => setImmediate(resolve));
export function job<T>(work: () => Promise<T>): InputByteJob<T> {
  const result = work(); return { result, settled: result.then(() => undefined, () => undefined) };
}
export function creation(id = 90, content = 'abc'): Extract<InputControl, { kind: 'createInput' }> {
  return { kind: 'createInput', id: uuid(id), request: { scope: { ...scope }, requestId: requestId(), name: ` Input ${id} `,
    bytes: Buffer.byteLength(content), sha256: digest(content) } };
}
export function transition(record: InputRecord, kind: 'sealInput' | 'deleteInput'): InputControl {
  return { kind, id: record.id, request: { scope: record.scope, requestId: requestId(), expectedVersion: record.version } };
}
export const source = (value: string) => async () => Buffer.from(value);
/** In-memory byte-port model only; this establishes no filesystem custody evidence. */
export function memoryBytes() {
  const files = new Map<string, Uint8Array>();
  const published = new Set<string>();
  const identity = (r: InputRecord) => `${r.scope.organizationId}/${r.scope.workspaceId}/${r.id}`;
  function verify(record: InputRecord): Uint8Array {
    const data = files.get(identity(record));
    if (!data) throw new InputByteError('custody_missing');
    if (data.length !== record.bytes || createHash('sha256').update(data).digest('hex') !== record.sha256) throw new InputByteError('integrity');
    return data;
  }
  const bytes: InputByteStore = {
    prepare: record => job(async () => {
      const name = identity(record); const current = files.get(name);
      if (!current && record.offset) throw new InputByteError('custody_missing');
      if (!current) files.set(name, new Uint8Array());
      else if (current.length < record.offset) throw new InputByteError('integrity');
      else files.set(name, current.slice(0, record.offset));
    }),
    append: (record, offset, read) => job(async () => {
      await bytes.prepare(record, { freeSpaceReserveBytes: 0 }).result;
      const data = await read(); const name = identity(record); const current = files.get(name)!;
      if (offset < record.offset) {
        if (!Buffer.from(current.slice(offset, offset + data.length)).equals(data)) throw new InputByteError('invalid_input');
        return record.offset;
      }
      files.set(name, Buffer.concat([current, data])); return offset + data.length;
    }),
    publish: record => job(async () => {
      if (record.bytes === 0 && !files.has(identity(record))) files.set(identity(record), new Uint8Array());
      verify(record); published.add(identity(record));
    }),
    remove: record => job(async () => { files.delete(identity(record)); published.delete(identity(record)); }),
    read: (record, range, sink) => job(async () => {
      const data = verify(record);
      if (!published.has(identity(record))) throw new InputByteError('custody_missing');
      for (let i = range.start; i < range.endExclusive; i += 65536) await sink.write(data.slice(i, Math.min(i + 65536, range.endExclusive)));
    }),
  };
  return { bytes, files, published, identity };
}
export async function setup(fixture: ReturnType<typeof storageFixture>, overrides: Partial<InputStore> = {}) {
  const dbPath = fixture.path(); const metadata = await fixture.open(dbPath, inputOptions()); await seed(metadata);
  const model = memoryBytes(); const store = { ...metadata.inputs, ...overrides };
  const service = createInputService({ store, bytes: model.bytes, digest });
  return { metadata, model, store, service, dbPath };
}
