import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { validateApi } from '@beetle/contracts/api';
import { ClientError } from './errors.js';
export type Command = 'connect' | 'pair' | 'run' | 'status' | 'result' | 'cancel' | 'compare';
export interface ClientOptions {
  readonly command: Command; readonly endpoint: string; readonly origin: string; readonly sessionFile: string;
  readonly tokenFile?: string; readonly requestFile?: string; readonly waitMs?: number;
  readonly run?: {readonly organizationId: string; readonly workspaceId: string; readonly runId: string};
}
const invalid = (): never => {throw new ClientError('invalid_input', 2);};
const names = ['connect', 'pair', 'run', 'status', 'result', 'cancel', 'compare'] as const;
const extras: Record<Command, readonly string[]> = {
  connect: [], pair: ['token-file'], run: ['request-file', 'wait-ms'], status: ['organization', 'workspace', 'run', 'wait-ms'],
  result: ['organization', 'workspace', 'run'], cancel: ['organization', 'workspace', 'run', 'request-file'], compare: ['request-file'],
};
function origin(value: string, local = false): string {
  try {
    const url = new URL(value);
    if (value !== url.origin || !['http:', 'https:'].includes(url.protocol)) return invalid();
    if (local && !(url.hostname === 'localhost' || url.hostname === '[::1]' || (isIP(url.hostname) === 4 && url.hostname.startsWith('127.')))) return invalid();
    return url.origin;
  } catch {return invalid();}
}
function flags(argv: readonly string[], command: Command): Map<string, string> {
  const values = new Map<string, string>(); const allowed = ['endpoint', 'origin', 'session-file', 'json', ...extras[command]];
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!; const key = flag.slice(2);
    if (!flag.startsWith('--') || !allowed.includes(key) || values.has(key)) return invalid();
    const value = key === 'json' ? 'true' : argv[++index];
    if (!value || value.startsWith('--')) return invalid(); values.set(key, value);
  }
  return values;
}
function file(values: Map<string, string>, key: string): string {
  const value = values.get(key); if (!value || !isAbsolute(value) || value.includes('\0')) return invalid(); return value;
}
function runScope(values: Map<string, string>) {
  const organizationId = values.get('organization'); const workspaceId = values.get('workspace'); const runId = values.get('run');
  if (!validateApi('Uuid', organizationId).ok || !validateApi('Uuid', workspaceId).ok || !validateApi('Uuid', runId).ok) return invalid();
  return Object.freeze({organizationId: organizationId!, workspaceId: workspaceId!, runId: runId!});
}
function specificOptions(command: Command, values: Map<string, string>) {
  return {...(command === 'pair' ? {tokenFile: file(values, 'token-file')} : {}),
    ...(['run', 'cancel', 'compare'].includes(command) ? {requestFile: file(values, 'request-file')} : {}),
    ...(['status', 'result', 'cancel'].includes(command) ? {run: runScope(values)} : {})};
}
function waiting(values: Map<string, string>) {
  const wait = values.get('wait-ms');
  if (wait === undefined) return {};
  if (!/^[1-9][0-9]{0,6}$/.test(wait) || Number(wait) > 3600000) return invalid();
  return {waitMs: Number(wait)};
}
export function parseOptions(argv: readonly string[]): ClientOptions {
  if (argv.length > 24 || argv.some(value => value.length > 1024) || argv.join('').length > 8192) return invalid();
  const name = argv[0]; if (!names.some(command => command === name)) return invalid(); const command = name as Command;
  const values = flags(argv, command);
  return Object.freeze({command, endpoint: origin(values.get('endpoint') ?? ''), origin: origin(values.get('origin') ?? '', true),
    sessionFile: file(values, 'session-file'), ...specificOptions(command, values), ...waiting(values)});
}
