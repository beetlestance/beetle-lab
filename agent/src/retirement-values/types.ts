import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { Scope } from '../admission/index.js';
export type RetirementTask = { readonly state: 'none' }
  | { readonly state: 'preparing'; readonly intentIdentity: string }
  | { readonly state: 'prepared'; readonly intentIdentity: string; readonly taskNamespaceIdentity: string };
export interface RetirementIntent {
  readonly protocolVersion: 1; readonly retirementVersion: 1;
  readonly request: RetirementRequest; readonly requestDigest: string;
  readonly namespaceIdentity: string; readonly task: RetirementTask;
}
export interface JournalRetirements {
  isOpen(key: Scope): Promise<boolean>;
  preflight(input: unknown): Promise<RetirementIntent>;
  begin(input: unknown): Promise<RetirementIntent>;
  read(key: Scope): Promise<RetirementIntent | null>;
  /** Call after the original command settles; failed workers retain actual termination. */
  settleCarrier(): Promise<void>;
}
