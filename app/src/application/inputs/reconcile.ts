import { InputByteError } from '../../ports/input-bytes.js';
import type { InputByteStore, InputByteContext } from '../../ports/input-bytes.js';
import type { InputRecord, InputStore } from '../../ports/inputs.js';
import { requireRule } from '../../domain/namespaces/index.js';
import type { Owner } from './ownership.js';
import { checkedRecord } from './validation.js';

export interface Dependencies { store: InputStore; bytes: InputByteStore }
export async function reserveBytes(store: InputStore, owner: Owner): Promise<number> {
  owner.check();
  const storage = await store.storage();
  requireRule(Number.isSafeInteger(storage.freeSpaceReserveBytes) && storage.freeSpaceReserveBytes >= 0);
  owner.check(); return storage.freeSpaceReserveBytes;
}
export async function custodyFailure(store: InputStore, owner: Owner, record: InputRecord, error: unknown): Promise<void> {
  if (!(error instanceof InputByteError)) return;
  if (error.code === 'custody_missing' || error.code === 'integrity') {
    await owner.drainCustody();
    await store.advance({ kind: 'failInput', key: { id: record.id, scope: record.scope },
      expectedVersion: record.version, reason: error.code });
  } else if (record.state === 'deleting' && error.code === 'io') {
    await owner.drainCustody();
    await store.advance({ kind: 'failInput', key: { id: record.id, scope: record.scope },
      expectedVersion: record.version, reason: 'io' });
  }
}
export async function reconcile(deps: Dependencies, owner: Owner, record: InputRecord): Promise<boolean> {
  if (record.state === 'failed' || record.state === 'deleted') return false;
  const reserve = await reserveBytes(deps.store, owner);
  const context = owner.context(reserve);
  try {
    await nativeReconcile(deps.bytes, owner, record, context);
    await owner.drainCustody(); owner.check();
  } catch (error) { await custodyFailure(deps.store, owner, record, error); throw error; }
  if (record.state === 'publishing' || record.state === 'deleting') {
    checkedRecord(await deps.store.advance({ kind: record.state === 'publishing' ? 'publishInput' : 'deleteInputBytes',
      key: { id: record.id, scope: record.scope }, expectedVersion: record.version }), record);
  }
  return true;
}

async function nativeReconcile(bytes: InputByteStore, owner: Owner, record: InputRecord, context: InputByteContext): Promise<void> {
  switch (record.state) {
    case 'staging': await owner.job(bytes.prepare(record, context)); break;
    case 'publishing': await owner.job(bytes.publish(record, context)); break;
    case 'deleting': await owner.job(bytes.remove(record, context)); break;
    case 'published': await owner.job(bytes.read(record, { start: 0, endExclusive: 0 },
      { write: async () => { throw new InputByteError('integrity'); } }, context)); break;
  }
}
