import type { ApiError, SettingsScope } from '@beetle/contracts/api';

type ErrorCode = Extract<ApiError['code'], 'not_found' | 'conflict' | 'invalid_value' | 'capacity_unavailable'>;
const messages = {
  not_found: 'Resource not found', conflict: 'Version or intent conflict',
  invalid_value: 'Invalid value', capacity_unavailable: 'Capacity unavailable',
} as const;

/** Static messages only: submitted values/IDs never become error text. */
export class SemanticError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(messages[code]);
    this.name = 'SemanticError';
    this.code = code;
  }
}

export function requireRule(condition: boolean, code: ErrorCode = 'invalid_value'): asserts condition {
  if (!condition) throw new SemanticError(code);
}

/** UUID text is case-insensitive; schema validation establishes its syntax first. */
export function sameUuid(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function sameScope(a: SettingsScope, b: SettingsScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'installation' || b.kind === 'installation') return true;
  if (!sameUuid(a.organizationId, b.organizationId)) return false;
  return a.kind !== 'workspace' || (b.kind === 'workspace' && sameUuid(a.workspaceId, b.workspaceId));
}

export function nextVersion(version: number): number {
  requireRule(Number.isSafeInteger(version) && version >= 1 && version < Number.MAX_SAFE_INTEGER, 'conflict');
  return version + 1;
}

export function normalizedName(value: string): string {
  const name = value.trim();
  requireRule([...name].length >= 1 && [...name].length <= 128);
  requireRule([...name].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));
  return name;
}

/** Stable, locale-independent sibling key; adapters must persist/use this exact fold. */
export function foldedName(value: string): string {
  return normalizedName(value).normalize('NFKC').toLowerCase();
}

export function validatedSlug(value: string): string {
  requireRule(value.length <= 128 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value));
  return value;
}

/** Copies JSON data before freezing, so freezing never takes ownership of caller data. */
export function immutableSnapshot<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(item => immutableSnapshot(item))) as T;
  if (value !== null && typeof value === 'object') {
    const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableSnapshot(item)]));
    return Object.freeze(copy) as T;
  }
  return value;
}
