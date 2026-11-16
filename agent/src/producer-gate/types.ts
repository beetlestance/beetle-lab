import type { Scope } from '../admission/index.js';
import type { JournalRetirements, RetirementIntent } from '../retirement-values/index.js';
export type ProducerGateReason = 'invalid_input' | 'owner' | 'capacity' | 'retired' | 'closed' | 'cleanup';
export class ProducerGateError extends Error {
  constructor(readonly reason: ProducerGateReason) { super(`Producer gate ${reason}`); }
}
export interface ProducerLease {
  readonly key: Readonly<Scope>;
  ready(): Promise<void>;
  check(): void;
  /** Retain actual issued owners through their result/quiescence/cached close. */
  issue<T extends object>(factory: () => T): T;
  /** Unknown factory/close outcome cannot be released by service rejection. */
  poison(): void;
  finish(): boolean;
}
/** Process-local fence only; neither a durable proof nor a C3 native capability. */
export interface ProducerFence {
  readonly key: Readonly<Scope>;
  fence(): void;
  confirm(intent: RetirementIntent): Promise<void>;
  drain(): Promise<void>;
  release(): void;
}
export interface GateOptions { readonly journal: JournalRetirements; readonly namespaceIdentity: string }
