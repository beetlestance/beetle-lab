import type { JournalRetirements } from '../retirement-values/index.js';
import type { GateEntry } from './entry.js';
import { leaseState } from './entry.js';
import { ProducerGateError } from './types.js';
import type { ProducerLease } from './types.js';
export function makeLease(entry: GateEntry, journal: JournalRetirements, release: () => void, closed: () => boolean): ProducerLease {
  const state = leaseState(); entry.leases.add(state);
  const check = () => { if (closed()) throw new ProducerGateError('closed'); if (state.poisoned) throw new ProducerGateError('cleanup'); if (entry.fenced || state.finished) throw new ProducerGateError('retired'); };
  const poison = () => {
    if (state.finished) throw new ProducerGateError('cleanup');
    entry.fenced = true; state.poisoned = true; state.reject(new ProducerGateError('cleanup'));
  };
  return Object.freeze({ key: entry.key, check, poison,
    ready: async () => {
      check(); const open = await journal.isOpen(entry.key);
      if (!open) { entry.fenced = true; entry.durable = true; }
      check();
    },
    issue: <T extends object>(factory: () => T): T => {
      check(); if (state.originals.size >= 4) throw new ProducerGateError('capacity');
      const slot: { factory: () => T; original?: T } = { factory }; state.originals.add(slot);
      try { slot.original = factory(); return slot.original; } catch (error) { poison(); throw error; }
    },
    finish: () => {
      if (state.poisoned) return false; if (state.finished) return true;
      state.finished = true; state.originals.clear(); entry.leases.delete(state); state.resolve(); release(); return true;
    },
  });
}
