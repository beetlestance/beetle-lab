import type { Scope } from '../admission/index.js';
import type { RetirementIntent,RetirementSelection } from '../retirement-values/index.js';
export type RetirementOperation = { readonly kind: 'retirementOpen' | 'retirementRead'; readonly key: Readonly<Scope> }
  | { readonly kind: 'retirementPreflight' | 'retirementBegin' | 'rejectedCleanupPreflight' | 'rejectedCleanupFund' | 'retirementSelection'; readonly json: string };
export type RetirementValue = { readonly key: Readonly<Scope>; readonly open: boolean }
  | { readonly key: Readonly<Scope>; readonly intent: RetirementIntent | null } | RetirementIntent | RetirementSelection;
export function retirementOperation(input: { kind: string }): input is RetirementOperation {
  return ['retirementOpen', 'retirementRead', 'retirementPreflight', 'retirementBegin', 'rejectedCleanupPreflight', 'rejectedCleanupFund','retirementSelection'].includes(input.kind);
}
