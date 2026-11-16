import { createHash } from 'node:crypto';
import { openLocalInputBytes } from '../adapters/outbound/files/inputs/index.js';
import { createInputService } from '../application/inputs/index.js';
import type { InputStore } from '../ports/inputs.js';
import type { InputService } from '../ports/input-service.js';
import { InputMaintenance } from './input-maintenance.js';
import type { InputMaintenanceState } from './input-maintenance.js';
import { initializeInputRoots } from './input-roots.js';

export interface InputRuntime {
  readonly inputs: InputService;
  readonly recoveryState: () => InputMaintenanceState;
  close(): Promise<void>;
}
/** The sole installation input service and maintenance owner. No HTTP registration. */
export async function openInputRuntime(directory: string, store: InputStore): Promise<InputRuntime> {
  const roots = await initializeInputRoots(directory);
  const bytes = await openLocalInputBytes(roots);
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
  const inputs = createInputService({ store, bytes, digest });
  const maintenance = new InputMaintenance(inputs);
  let closing: Promise<void> | undefined;
  return Object.freeze({ inputs, recoveryState: () => maintenance.state,
    close: (): Promise<void> => {
      if (!closing) {
        // Start both before waiting: aborted scheduling cannot retire native originals.
        const scheduled = maintenance.close(); const custody = inputs.close();
        closing = Promise.allSettled([scheduled, custody]).then(results => {
          for (const result of results) if (result.status === 'rejected') throw result.reason;
        });
      }
      return closing;
    } });
}
