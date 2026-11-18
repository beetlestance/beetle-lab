import { sameScope, sameUuid, requireRule } from '../../domain/namespaces/index.js';
import { InputByteError } from '../../ports/input-bytes.js';
import type { InputService } from '../../ports/input-service.js';
import type { InputKey, InputRecord } from '../../ports/inputs.js';
import { checkedRecord, keySnapshot } from './validation.js';
import { shapeCounter } from './shape.js';
import type { ShapeCounter, ShapeKind } from './shape.js';

/** One verified read under the existing byte owner. Names are not a promise that the dataset compiles. */
export async function discoverInputColumns(
  service: Pick<InputService, 'get' | 'read'>,
  key: InputKey,
  kind: ShapeKind,
  signal?: AbortSignal,
) {
  const captured = keySnapshot(key);
  requireRule(kind === 'csv' || kind === 'json');
  checkCancelled(signal);
  const before = checkedRecord(await service.get(captured), captured);
  requireRule(before.state === 'published', 'conflict');
  const discovery = columnSink(kind, before.bytes);
  const after = checkedRecord(
    await service.read(captured, undefined, discovery, signal === undefined ? undefined : { signal }),
    captured,
  );
  checkCancelled(signal);
  checkIdentity(before, after);
  const columns = discovery.result();
  return {
    scope: before.scope,
    inputId: before.id,
    sha256: before.sha256,
    bytes: before.bytes,
    kind,
    columns: columns === null ? null : [...columns],
  };
}

function checkCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new InputByteError('cancelled');
}
function checkIdentity(before: InputRecord, after: InputRecord) {
  if (
    !sameScope(before.scope, after.scope) ||
    !sameUuid(before.id, after.id) ||
    before.sha256 !== after.sha256 ||
    before.bytes !== after.bytes ||
    after.state !== 'published'
  )
    throw new Error('Input discovery identity mismatch');
}

/** Allocate and finalize the parser inside the admitted sink, before native byte custody can release. */
function columnSink(kind: ShapeKind, bytes: number) {
  let counter: ShapeCounter | undefined;
  let received = 0;
  let columns: readonly string[] | null = null;
  return {
    write: async (chunk: Uint8Array) => {
      if (received + chunk.byteLength > bytes) throw new InputByteError('integrity');
      counter ??= shapeCounter(kind);
      counter.write(chunk);
      received += chunk.byteLength;
      if (received === bytes) {
        columns = counter.finish() === null ? null : counter.columnNames();
        counter = undefined;
      }
    },
    result: () => {
      if (received !== bytes) throw new Error('Incomplete input discovery');
      return columns;
    },
  };
}
