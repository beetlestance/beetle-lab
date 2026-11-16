import { validatePrimitive } from '@beetle/contracts';
import type { DispatchKey } from '../../../ports/dispatch.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { boundedCopy } from './input-values.js';

/** Capture the original closed identity without invoking caller accessors. */
export function captureDispatchKey(input: unknown): DispatchKey {
  const key = boundedCopy(input, 1024) as DispatchKey;
  requireRule(key !== null && typeof key === 'object' && Object.keys(key).length === 2
    && Object.hasOwn(key, 'runId') && Object.hasOwn(key, 'attempt'));
  const attempt = key.attempt;
  requireRule(attempt !== null && typeof attempt === 'object' && Object.keys(attempt).length === 5
    && ['attemptId', 'organizationId', 'workspaceId', 'intentDigest', 'generation'].every(field => Object.hasOwn(attempt, field)));
  requireRule([key.runId, attempt.attemptId, attempt.organizationId, attempt.workspaceId]
    .every(value => validatePrimitive('uuid', value).ok));
  requireRule(attempt.generation === 1 && typeof attempt.intentDigest === 'string' && /^[a-f0-9]{64}$/.test(attempt.intentDigest));
  return key;
}
