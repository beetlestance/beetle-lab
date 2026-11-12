import { initialize } from '../../src/journal/schema.js';
import { AdmissionStore } from '../../src/journal/admission-store.js';
import { bindSyntheticStore } from '../staging-namespace/model-fixtures.js';
import { configuration, job, now, observation, reserved, scope, validation } from './fixtures.js';
/** Current metadata-only admitted/aborted originals; never adopt unanchored old history. */
export function seedHeldOriginals(path: string, count: number): void {
  const db = initialize(path);
  try {
    bindSyntheticStore(db); const store = new AdmissionStore(db, 67_108_864);
    const config = configuration(); config.pool.outputBytes = 1_000_000; config.pool.stagingBytes = 2_000_000_000;
    store.execute({ kind: 'configure', configuration: config });
    store.execute({ kind: 'observe', observation: { ...observation(), capacity: config.pool, freeDiskBytes: 3_000_000_000 } });
    for (let id = 1; id <= count; id++) {
      const offer = job(id);
      store.execute({ kind: 'offer', offer, validation: validation(offer), now });
      reserved(store.execute({ kind: 'admit', key: scope(offer), sourceOrdinal: 1, now }));
      const released = reserved(store.execute({ kind: 'abortUnstarted', key: scope(offer) }));
      if (released.status !== 'released') throw new Error('Synthetic held original did not release runtime reservation');
    }
  } finally { db.close(); }
}
