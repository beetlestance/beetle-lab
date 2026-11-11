import { isAbsolute } from 'node:path';

export interface Check { id: string; argv: string[]; timeoutMs: number }
export interface Plan { cwd: string; checks: Check[] }
function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown field');
  return value as Record<string, unknown>;
}
function argumentsList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32
    || !value.every((arg: unknown): arg is string => typeof arg === 'string' && arg.length > 0 && arg.length <= 4096 && !arg.includes('\0'))) throw new Error('Invalid command arguments');
  return [...value];
}
function check(value: unknown): Check {
  const entry = record(value, ['id', 'argv', 'timeoutMs']);
  if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(entry.id)) throw new Error('Invalid check id');
  const argv = argumentsList(entry.argv);
  if (typeof entry.timeoutMs !== 'number' || !Number.isInteger(entry.timeoutMs)
    || entry.timeoutMs < 1 || entry.timeoutMs > 900000) throw new Error('Invalid timeout');
  return {id: entry.id, argv: [...argv], timeoutMs: entry.timeoutMs};
}
/** Validate the entire plan before creating evidence or starting a command. */
export function capturePlan(value: unknown): Plan {
  const input = record(value, ['cwd', 'checks']);
  const cwd = directory(input.cwd);
  if (!Array.isArray(input.checks) || !input.checks.length || input.checks.length > 16) throw new Error('Expected 1–16 checks');
  const checks = input.checks.map(check); const ids = new Set<string>(); const commands = new Set<string>();
  for (const entry of checks) {
    const command = JSON.stringify(entry.argv);
    if (ids.has(entry.id) || commands.has(command)) throw new Error('Duplicate check id or command');
    ids.add(entry.id); commands.add(command);
  }
  return {cwd, checks};
}
function directory(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || value.includes('\0')) throw new Error('Expected absolute cwd');
  return value;
}
