import type { Worker } from 'node:worker_threads';
import { vi } from 'vitest';
import type { Offer } from '@beetle/contracts';
import type { Journal } from '../../src/journal/index.js';

/** Synthetic transport delay; actual Journal originals keep both large credits. */
export async function creditHold(journal: Journal, target: Offer) {
  const offers = [91, 92].map(id => ({ ...structuredClone(target),
    attemptId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}` }));
  for (const offer of offers) await journal.immutableOffer(offer);
  const worker = (journal as unknown as { worker: Worker }).worker;
  const post = worker.postMessage.bind(worker);
  const held: unknown[] = []; const reads: string[] = [];
  let holding = true; let originals: Promise<Offer>[] = [];
  const spy = vi.spyOn(worker, 'postMessage').mockImplementation((message: unknown) => {
    const value = message as { kind: string; key?: { attemptId: string } };
    if (value.kind === 'read') {
      reads.push(value.key!.attemptId);
      if (holding && offers.some(offer => offer.attemptId === value.key!.attemptId)) {
        held.push(message); return;
      }
    }
    post(message);
  });
  return { reads, held,
    start() { originals = offers.map(offer => journal.readOffer({ attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId })); },
    async release() {
      holding = false;
      for (const message of held.splice(0)) post(message);
      await Promise.all(originals);
    },
    async close() {
      holding = false;
      for (const message of held.splice(0)) post(message);
      await Promise.allSettled(originals); spy.mockRestore();
    } };
}
