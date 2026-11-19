import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';

export const STOPPED_HISTORY_RPC_BYTES = 2 * LIVE_HISTORY_BYTES + 4096;

function data(object: unknown, key: string): unknown {
  if (typeof object !== 'object' || object === null) return undefined;
  const field = Object.getOwnPropertyDescriptor(object, key);
  return field && 'value' in field ? field.value : undefined;
}

export function hasStoppedHistoryPayload(input: unknown): boolean {
  const kind = data(input, 'kind');
  if (kind !== 'absenceFinalize' && kind !== 'outputFinalize') return false;
  const history = data(data(input, 'request'), 'stoppedHistory');
  return typeof history === 'object' && history !== null;
}
