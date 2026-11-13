import { copyControlScope } from '../control-protocol/index.js';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { Scope } from '../admission/index.js';
import { ProducerGateError } from './types.js';
export interface LeaseState {
  readonly originals: Set<object>; readonly done: Promise<void>;
  resolve(): void; reject(error: unknown): void;
  poisoned: boolean; finished: boolean;
}
export interface GateEntry {
  readonly key: Readonly<Scope>; readonly leases: Set<LeaseState>;
  fenced: boolean; durable: boolean; barrier: boolean;
}
export function captureKey(input: Scope): Readonly<Scope> {
  try { const key = copyControlScope(input); if (key.generation !== 1) throw new Error(); return Object.freeze(key); }
  catch { throw new ProducerGateError('invalid_input'); }
}
export const identity = (key: Scope): string => encodeCanonicalJson(key, 640);
export function leaseState(): LeaseState {
  let resolve!: () => void; let reject!: (error: unknown) => void;
  const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void done.catch(() => undefined);
  return { originals: new Set(), done, resolve, reject, poisoned: false, finished: false };
}
