import { validatePrimitive } from '@beetle/contracts';
import { originAccess, originAccessFor } from '../../../app/src/bootstrap/configuration.js';
import { ProvisionError } from '../types.js';
import { fields } from './capture.js';

/**
 * Decision 032 amendment: the selector's `origin` field. `baseline` is the origin the
 * provision request was recorded with, so the receipt's request digest never changes;
 * `current` is the origin the installation now serves. Present only while they differ.
 */
export interface OriginSelector {
  readonly version: 1;
  readonly operationId: string;
  readonly baseline: string;
  readonly current: string;
}
function valid(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('recovery_required');
}
/** A canonical loopback or HTTPS origin, under the same rules the backend applies at startup. */
export function validOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    if (new URL(value).origin !== value) return false;
    originAccess(originAccessFor(value), value);
    return true;
  } catch {
    return false;
  }
}
export function captureOriginSelector(value: unknown): OriginSelector {
  fields(value, ['version', 'operationId', 'baseline', 'current']);
  valid(value.version === 1 && validatePrimitive('uuid', value.operationId).ok);
  valid(validOrigin(value.baseline) && validOrigin(value.current) && value.baseline !== value.current);
  return Object.freeze({
    version: 1,
    operationId: value.operationId as string,
    baseline: value.baseline,
    current: value.current,
  });
}
