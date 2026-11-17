import { InputByteError } from '../../ports/input-bytes.js';
import type { InputByteStore, InputByteContext } from '../../ports/input-bytes.js';
import type { InputRecord, InputStore } from '../../ports/inputs.js';
import { requireRule } from '../../domain/namespaces/index.js';
import type { Owner } from './ownership.js';
import { checkedRecord } from './validation.js';
import { shapeCounter, shapeKind } from './shape.js';
import { contentSink } from './transfer.js';

export interface Dependencies {
  store: InputStore;
  bytes: InputByteStore;
}
export async function reserveBytes(store: InputStore, owner: Owner): Promise<number> {
  owner.check();
  const storage = await store.storage();
  requireRule(Number.isSafeInteger(storage.freeSpaceReserveBytes) && storage.freeSpaceReserveBytes >= 0);
  owner.check();
  return storage.freeSpaceReserveBytes;
}
export async function custodyFailure(
  store: InputStore,
  owner: Owner,
  record: InputRecord,
  error: unknown,
): Promise<void> {
  if (!(error instanceof InputByteError)) return;
  if (error.code === 'custody_missing' || error.code === 'integrity') {
    await owner.drainCustody();
    await store.advance({
      kind: 'failInput',
      key: { id: record.id, scope: record.scope },
      expectedVersion: record.version,
      reason: error.code,
    });
  } else if (record.state === 'deleting' && error.code === 'io') {
    await owner.drainCustody();
    await store.advance({
      kind: 'failInput',
      key: { id: record.id, scope: record.scope },
      expectedVersion: record.version,
      reason: 'io',
    });
  }
}
export async function reconcile(deps: Dependencies, owner: Owner, record: InputRecord): Promise<boolean> {
  if (record.state === 'failed' || record.state === 'deleted') return false;
  const reserve = await reserveBytes(deps.store, owner);
  const context = owner.context(reserve);
  try {
    await nativeReconcile(deps.bytes, owner, record, context);
    await owner.drainCustody();
    owner.check();
  } catch (error) {
    await custodyFailure(deps.store, owner, record, error);
    throw error;
  }
  if (record.state === 'publishing' || record.state === 'deleting') {
    const next = checkedRecord(
      await deps.store.advance({
        kind: record.state === 'publishing' ? 'publishInput' : 'deleteInputBytes',
        key: { id: record.id, scope: record.scope },
        expectedVersion: record.version,
      }),
      record,
    );
    if (next.state === 'published') await measure(deps, owner, next);
  }
  return true;
}
/** Once, at publication: counts come only from a fully verified read of the published
 * bytes. Any failure leaves the counts null; conclusive custody evidence still fences
 * the input exactly as a content read would. Publication itself is already committed.
 */
export async function measure(deps: Dependencies, owner: Owner, record: InputRecord): Promise<void> {
  const kind = shapeKind(record.name, record.bytes);
  if (kind === null || record.state !== 'published') return;
  const counter = shapeCounter(kind);
  const consumer = contentSink(owner, { write: async (chunk) => counter.write(chunk) }, record.bytes);
  try {
    const reserve = await reserveBytes(deps.store, owner);
    try {
      await owner.job(
        deps.bytes.read(record, { start: 0, endExclusive: record.bytes }, consumer, owner.context(reserve)),
      );
    } finally {
      consumer.end();
    }
    await owner.drainCustody();
    owner.check();
    consumer.complete();
  } catch (error) {
    await custodyFailure(deps.store, owner, record, error).catch(() => undefined);
    return;
  }
  const shape = counter.finish();
  if (shape === null) return;
  const key = { id: record.id, scope: record.scope };
  await deps.store.recordShape({ key, sha256: record.sha256, bytes: record.bytes, ...shape }).catch(() => undefined);
}

async function nativeReconcile(
  bytes: InputByteStore,
  owner: Owner,
  record: InputRecord,
  context: InputByteContext,
): Promise<void> {
  switch (record.state) {
    case 'staging':
      await owner.job(bytes.prepare(record, context));
      break;
    case 'publishing':
      await owner.job(bytes.publish(record, context));
      break;
    case 'deleting':
      await owner.job(bytes.remove(record, context));
      break;
    case 'published':
      await owner.job(
        bytes.read(
          record,
          { start: 0, endExclusive: 0 },
          {
            write: async () => {
              throw new InputByteError('integrity');
            },
          },
          context,
        ),
      );
      break;
  }
}
