import { encodeJson } from '@beetle/contracts';
import { containerId } from './inspect.js';
/** Trusted retirement composition derives this from the exact released Journal original. */
export interface RetiredRuntimeBinding { readonly runtimeId: string; readonly daemonId: string }
export function captureRetiredRuntimeBinding(input: RetiredRuntimeBinding): RetiredRuntimeBinding | undefined {
  try {
    const raw: unknown = JSON.parse(encodeJson(input, 512));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).sort().join(',') !== 'daemonId,runtimeId' || !containerId(row.runtimeId)
      || typeof row.daemonId !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(row.daemonId)) return undefined;
    return Object.freeze({ runtimeId: row.runtimeId, daemonId: row.daemonId });
  } catch { return undefined; }
}
