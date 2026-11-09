import { StorageError } from '../adapters/outbound/sqlite/index.js';
import type { Metadata } from '../adapters/outbound/sqlite/index.js';
import type { RuntimePublisher } from './runtime-poller.js';

/** Expiry/order refusal is explicit; storage ownership/unknown outcome errors propagate. */
export function createRuntimePublisher(metadata: Pick<Metadata, 'updateRuntime'>): RuntimePublisher {
  const update = metadata.updateRuntime.bind(metadata);
  return async observation => {
    try {
      if (await update(observation) !== null) throw new Error('Invalid runtime publication acknowledgement');
      return true;
    }
    catch (error) {
      if (observation !== null && error instanceof StorageError &&
        (error.code === 'invalid_input' || error.code === 'invalid_value')) return false;
      throw error;
    }
  };
}
