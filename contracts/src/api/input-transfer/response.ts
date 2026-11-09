import type { InputRecord } from '../generated/types.js';
import type { InputTransferResult } from '../input-transfer-types.js';
import { validateApi } from '../validate.js';
import type { Operation } from './lifetime.js';
import type { Intent } from './snapshot.js';

export async function bytes(owner: Operation, maximum: number, exact: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Uint8Array(maximum);
  let size = 0;
  let reads = 0;
  while (true) {
    const next = await owner.read();
    if (next.done) break;
    if (++reads > maximum + 1 || !(next.value instanceof Uint8Array) || size + next.value.byteLength > maximum) throw new Error('body_limit');
    output.set(next.value, size);
    size += next.value.byteLength;
  }
  if (exact && size !== maximum) throw new Error('truncated');
  return exact ? output : output.subarray(0, size);
}
export async function json(owner: Operation, response: Response): Promise<unknown> {
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new Error('content_type');
  const body = await bytes(owner, 65_536, false);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
}
function immutableMatches(actual: InputRecord, expected: InputRecord): boolean {
  const immutable = ['id', 'folderId', 'name', 'sha256', 'bytes'] as const;
  return immutable.every(key => actual[key] === expected[key]) && actual.scope.kind === expected.scope.kind &&
    actual.scope.organizationId === expected.scope.organizationId && actual.scope.workspaceId === expected.scope.workspaceId;
}
export function acknowledgement(request: Intent, value: unknown): InputRecord {
  const checked = validateApi('InputRecord', value);
  if (!checked.ok) throw new Error('response');
  const actual = checked.value;
  const expected = request.record;
  if (!immutableMatches(actual, expected)) throw new Error('binding');
  const fresh = request.offset === expected.offset;
  if (actual.state !== 'staging' || actual.reason !== null || actual.offset !== (fresh ? expected.offset + request.chunk!.length : expected.offset) ||
    actual.version !== expected.version + (fresh ? 1 : 0)) throw new Error('progress');
  return actual;
}
export async function protocol(owner: Operation, response: Response): Promise<InputTransferResult<never>> {
  const checked = validateApi('ApiError', await json(owner, response));
  return checked.ok ? { ok: false, issued: owner.issued, error: { kind: 'protocol', status: response.status, protocol: checked.value } }
    : { ok: false, issued: owner.issued, error: { kind: 'response', status: response.status } };
}
export function downloadHeaders(response: Response, record: InputRecord): void {
  const headers = response.headers;
  if (headers.get('content-type')?.toLowerCase() !== 'application/octet-stream' || headers.get('etag') !== `"${record.sha256}"`) throw new Error('headers');
  const encoding = headers.get('content-encoding');
  if (encoding !== null && encoding.toLowerCase() !== 'identity') throw new Error('encoding');
  const length = headers.get('content-length');
  if (length !== null && (record.bytes !== 0 || length !== '0')) throw new Error('framing');
  if (headers.has('content-range')) throw new Error('range');
}
