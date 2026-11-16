import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RunResultSnapshot } from '@beetle/contracts/api';
import type { RunResultReader } from '../../../../ports/run-results.js';
import type { RunKey } from '../../../../ports/runs.js';
import { requireRule, sameScope } from '../../../../domain/namespaces/index.js';
import { ApiFault } from '../api-errors.js';
import { ResponseContractError } from '../schema-compilers.js';

/** Capture the operation-specific public bound before the general API serializer. */
export async function getResult(key: RunKey, reader: RunResultReader | undefined): Promise<RunResultSnapshot> {
  if (!reader) throw new ApiFault('storage_unavailable');
  const original = await reader.getRunResult(key);
  let copy: unknown;
  try { copy = JSON.parse(encodeJson(original, 73728)) as unknown; } catch { throw new ResponseContractError(); }
  const checked = validateApi('RunResultSnapshot', copy);
  if (!checked.ok) throw new ResponseContractError();
  const value = checked.value;
  requireRule(value.id.toLowerCase() === key.id.toLowerCase() && sameScope(value.scope, key.scope), 'not_found');
  const result = value.result;
  if (result !== null && (result.attemptId.toLowerCase() !== value.activeAttemptId.toLowerCase()
    || result.organizationId.toLowerCase() !== value.scope.organizationId.toLowerCase()
    || result.workspaceId.toLowerCase() !== value.scope.workspaceId.toLowerCase()
    || result.generation !== 1)) throw new ResponseContractError();
  return value;
}
