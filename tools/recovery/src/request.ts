import { isAbsolute, normalize } from 'node:path';
import { limits, RecoveryError } from './types.js';
import type { RecoveryLimits } from './types.js';
interface Common {readonly version: 1; readonly limits: RecoveryLimits; readonly timeoutMs: number}
export type RecoveryRequest = Common & (
  {readonly command: 'backup'; readonly source: string; readonly destination: string}
  | {readonly command: 'restore'; readonly archive: string; readonly destination: string; readonly operationId: string; readonly resume?: true}
  | {readonly command: 'serve'; readonly root: string; readonly externalOrigin: string; readonly host: '127.0.0.1' | '0.0.0.0' | '::1'; readonly port: number});
function path(value: unknown): void {
  if (typeof value !== 'string' || value.length > 4096 || !isAbsolute(value) || normalize(value) !== value || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new RecoveryError('invalid_input');
}
export function captureRequest(input: unknown): RecoveryRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RecoveryError('invalid_input');
  const value = input as Record<string, unknown>;
  const fields = commandFields(value);
  if (Object.keys(value).some(key => !['version','limits','timeoutMs',...fields].includes(key))) throw new RecoveryError('invalid_input');
  common(value);
  return Object.freeze({...value, limits: limits(value.limits as RecoveryLimits)}) as unknown as RecoveryRequest;
}
function commandFields(value: Record<string, unknown>): string[] {
  if (value.command === 'backup') {path(value.source); path(value.destination); return ['command','source','destination'];}
  if (value.command === 'restore') {path(value.archive); path(value.destination); return ['command','archive','destination','operationId','resume'];}
  if (value.command === 'serve') {
    path(value.root);
    if (!['127.0.0.1','0.0.0.0','::1'].includes(String(value.host)) || !Number.isSafeInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535 || typeof value.externalOrigin !== 'string') throw new RecoveryError('invalid_input');
    return ['command','root','externalOrigin','host','port'];
  }
  throw new RecoveryError('invalid_input');
}

function common(value: Record<string, unknown>): void {
  if (value.version !== 1 || !Number.isSafeInteger(value.timeoutMs) || Number(value.timeoutMs) < 100 || Number(value.timeoutMs) > 3600000) throw new RecoveryError('invalid_input');
  if (!value.limits || typeof value.limits !== 'object' || Object.keys(value.limits).sort().join(',') !== 'maximumBytes,maximumEntries') throw new RecoveryError('invalid_input');
}
