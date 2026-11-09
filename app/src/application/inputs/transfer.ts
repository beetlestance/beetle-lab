import { requireRule } from '../../domain/namespaces/index.js';
import { INPUT_CHUNK_BYTES } from '../../ports/inputs.js';
import { InputByteError } from '../../ports/input-bytes.js';
import type { InputChunkSource, InputContentSink } from '../../ports/input-bytes.js';
import type { InputRecord } from '../../ports/inputs.js';
import type { Owner } from './ownership.js';

/** The callback gate ends with the byte result, but already-started originals stay owned. */
export function chunkSource(owner: Owner, record: InputRecord, offset: number, source: InputChunkSource) {
  let active = true;
  let used = false;
  let length = 0;
  const readOnce = async (): Promise<Uint8Array> => {
    requireRule(active && !used); owner.check(); used = true;
    const value = await callback(owner, source);
    requireRule(value instanceof Uint8Array && value.byteLength >= 1 && value.byteLength <= INPUT_CHUNK_BYTES);
    requireRule(offset + value.byteLength <= record.bytes);
    requireRule(offset === record.offset || offset + value.byteLength <= record.offset);
    length = value.byteLength;
    owner.check(); return Uint8Array.from(value);
  };
  return { read: () => owner.track(readOnce()), end: () => { active = false; }, next: () => {
    requireRule(used && length > 0);
    return offset === record.offset ? offset + length : record.offset;
  } };
}
export function contentSink(owner: Owner, sink: InputContentSink, bytes: number) {
  let active = true;
  let writing = false;
  let total = 0;
  const writeOnce = async (chunk: Uint8Array): Promise<void> => {
    if (!active) throw new InputByteError('cancelled');
    requireRule(!writing && chunk instanceof Uint8Array && chunk.byteLength >= 1 && chunk.byteLength <= INPUT_CHUNK_BYTES);
    requireRule(total + chunk.byteLength <= bytes); owner.check();
    writing = true; total += chunk.byteLength;
    try { await callback(owner, () => sink.write(Uint8Array.from(chunk))); }
    finally { writing = false; }
    owner.check();
  };
  return { write: (chunk: Uint8Array) => owner.track(writeOnce(chunk)), end: () => { active = false; }, complete: () => { requireRule(total === bytes); } };
}

/** Consumer errors cannot impersonate conclusive filesystem integrity evidence. */
async function callback<T>(owner: Owner, work: () => Promise<T>): Promise<T> {
  try { return await owner.track(Promise.resolve(work())); }
  catch { owner.check(); throw new InputByteError('io'); }
}
