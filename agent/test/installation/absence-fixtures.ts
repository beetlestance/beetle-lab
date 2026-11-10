import { vi } from 'vitest';
import type { Journal } from '../../src/journal/index.js';

/** Hold the actual compiled worker COMMIT reply, without synthesizing proof bytes. */
export function withheldAbsence(journal: Journal) {
  const receive = Reflect.get(journal, 'receive') as (reply: unknown) => void;
  let reply: unknown; let signal!: () => void;
  const observed = new Promise<void>(resolve => { signal = resolve; });
  const issue = journal.closeOutputAbsence.bind(journal);
  const spy = vi.spyOn(journal, 'closeOutputAbsence').mockImplementation(input => {
    const id = Number(Reflect.get(journal, 'nextId')) + 1;
    Reflect.set(journal, 'receive', (candidate: unknown) => {
      if (candidate && typeof candidate === 'object' && Reflect.get(candidate, 'id') === id) {
        reply = candidate; signal(); return;
      }
      receive.call(journal, candidate);
    });
    return issue(input);
  });
  return { spy, observed, deliver() {
    Reflect.set(journal, 'receive', receive);
    if (reply) { const value = reply; reply = undefined; receive.call(journal, value); }
  } };
}
