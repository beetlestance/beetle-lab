import { requireRule } from '../../../../domain/namespaces/index.js';
import { StorageError } from '../protocol.js';
/** Keyset position over workspaces(organization_id,id), then runs(id) inside one retired workspace. */
export interface ReclaimPosition {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly inside: boolean;
}
const tag = 'retired-reclaim-v1';
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const reclaimStart: ReclaimPosition = { organizationId: '', workspaceId: '', runId: '', inside: false };
export function reclaimCursor(position: ReclaimPosition): string {
  const { organizationId, workspaceId, runId, inside } = position;
  return Buffer.from(JSON.stringify([tag, inside ? 1 : 0, organizationId, workspaceId, runId])).toString('base64url');
}
/** A cursor is only a position hint; it grants no eligibility. Malformed input is invalid. */
export function reclaimPosition(cursor: string | undefined): ReclaimPosition {
  if (cursor === undefined) return reclaimStart;
  try {
    const position = decode(cursor);
    requireRule(reclaimCursor(position) === cursor);
    return position;
  } catch {
    throw new StorageError('invalid_input');
  }
}
function decode(cursor: string): ReclaimPosition {
  requireRule(cursor.length <= 256 && /^[A-Za-z0-9_-]+$/.test(cursor));
  const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
  requireRule(Array.isArray(value) && value.length === 5 && value[0] === tag && (value[1] === 0 || value[1] === 1));
  const [, inside, organizationId, workspaceId, runId] = value as [string, number, unknown, unknown, unknown];
  requireRule(isId(organizationId) && isId(workspaceId));
  requireRule(runId === '' || (inside === 1 && isId(runId)));
  return { organizationId, workspaceId, runId: runId as string, inside: inside === 1 };
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && id.test(value);
}
