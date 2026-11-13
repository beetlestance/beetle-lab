import type { Scope } from '../admission/index.js';
import type { RetirementIntent } from '../retirement-values/index.js';
export type RetirementOperation = { readonly kind: 'retirementOpen' | 'retirementRead'; readonly key: Readonly<Scope> }
  | { readonly kind: 'retirementPreflight' | 'retirementBegin'; readonly json: string };
export type RetirementValue = { readonly key: Readonly<Scope>; readonly open: boolean }
  | { readonly key: Readonly<Scope>; readonly intent: RetirementIntent | null } | RetirementIntent;
export function retirementOperation(input: { kind: string }): input is RetirementOperation {
  return ['retirementOpen', 'retirementRead', 'retirementPreflight', 'retirementBegin'].includes(input.kind);
}
