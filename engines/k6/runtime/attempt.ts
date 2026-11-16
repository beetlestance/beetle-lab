import { stop } from './failure.js';

export type AttemptBudget = { mode: 'managed'; timeoutMs: number; deadlineMs: number }
  | { mode: 'standalone'; timeoutMs: number };
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function positive(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}
function attemptMode(value: unknown): AttemptBudget['mode'] {
  if (value === 'managed' || value === 'standalone') return value;
  return stop('invalid_limits');
}
function closedKeys(value: Record<string, unknown>, mode: AttemptBudget['mode']): void {
  const allowed = mode === 'managed' ? ['mode', 'timeoutMs', 'deadlineMs'] : ['mode', 'timeoutMs'];
  for (const key in value) if (Object.hasOwn(value, key) && !allowed.includes(key)) stop('invalid_limits');
}
/** Private trusted-launch options still fail closed at their serialization boundary. */
export function validateAttempt(value: unknown): AttemptBudget {
  if (!record(value) || !Object.hasOwn(value, 'mode') || !Object.hasOwn(value, 'timeoutMs')) return stop('invalid_limits');
  const mode = attemptMode(value.mode);
  const timeoutMs = value.timeoutMs;
  if (!positive(timeoutMs, 172_800_000)) return stop('invalid_limits');
  closedKeys(value, mode);
  if (mode === 'standalone') return { mode, timeoutMs };
  const deadlineMs = value.deadlineMs;
  if (!Object.hasOwn(value, 'deadlineMs') || !positive(deadlineMs)) return stop('invalid_limits');
  return { mode, timeoutMs, deadlineMs };
}
/** Standalone starts once at setup; managed also accounts for time consumed earlier. */
export function attemptDeadline(attempt: AttemptBudget, now: number): number {
  const validated = validateAttempt(attempt);
  const deadline = now + validated.timeoutMs;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(deadline)) return stop('deadline');
  const result = validated.mode === 'managed' ? Math.min(deadline, validated.deadlineMs) : deadline;
  if (result <= now) return stop('deadline');
  return result;
}
export function setupDeadline(data: unknown): number {
  if (!record(data) || !Object.hasOwn(data, 'deadlineMs')) return stop('deadline');
  const deadline = data.deadlineMs;
  if (typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || deadline < 1) return stop('deadline');
  return deadline;
}
