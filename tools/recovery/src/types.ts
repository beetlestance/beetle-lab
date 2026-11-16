export type RecoveryCode = 'invalid_input' | 'owned' | 'io' | 'limit' | 'cancelled' | 'deadline' | 'cleanup' | 'not_cold' | 'conflict' | 'integrity' | 'incomplete';
export class RecoveryError extends Error {
  constructor(readonly code: RecoveryCode) {super(`Recovery ${code}`);}
}
export interface RecoveryOperation {readonly signal: AbortSignal; readonly deadline: number}
export interface RecoveryLimits {readonly maximumBytes: number; readonly maximumEntries: number}
export interface Owned<T> {readonly value: T; readonly release: () => unknown; close?: Promise<void>}
export function check(operation: RecoveryOperation): void {
  if (operation.signal.aborted) throw new RecoveryError('cancelled');
  const now = performance.now();
  if (!Number.isFinite(operation.deadline) || !Number.isFinite(now) || now >= operation.deadline) throw new RecoveryError('deadline');
}
export function limits(input: RecoveryLimits): RecoveryLimits {
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1 || !Number.isSafeInteger(input.maximumEntries)
    || input.maximumEntries < 1 || input.maximumEntries > 100000) throw new RecoveryError('invalid_input');
  return Object.freeze({maximumBytes: input.maximumBytes, maximumEntries: input.maximumEntries});
}
