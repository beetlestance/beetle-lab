import { encodeJson } from '../../json.js';
import type { InputRecord } from '../generated/types.js';
import type { InputTransferOptions } from '../input-transfer-types.js';
import { validateApi } from '../validate.js';
import {inputChunkPath,inputContentPath,INPUT_CHUNK_BYTES} from '../input-content.js';

export interface Configuration { base: string; fetch: typeof fetch; headers: Record<string, string>; timeout: number }
export interface Intent { record: InputRecord; signal: AbortSignal | undefined; offset: number; chunk: Uint8Array<ArrayBuffer> | undefined }

export function fields(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) throw new Error('invalid');
  const keys = Reflect.ownKeys(input);
  if (keys.length > allowed.length) throw new Error('invalid');
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new Error('invalid');
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !('value' in property)) throw new Error('invalid');
    copy[key] = property.value;
  }
  return copy;
}
function headerValue(name: string, value: unknown): string {
  const reserved = /^(?:content-(?:type|length|encoding|range)|transfer-encoding|host|connection|range|if-.*|cookie2?|origin|referer|upgrade|expect|trailer|te|keep-alive|accept-encoding|proxy-.*|sec-.*)$/i;
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]{1,64}$/i.test(name) || reserved.test(name)) throw new Error('invalid');
  if (typeof value !== 'string' || value.length > 2048 || /[\r\n]/.test(value)) throw new Error('invalid');
  return value;
}
function headers(input: unknown): Record<string, string> {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object') throw new Error('invalid');
  const keys = Reflect.ownKeys(input);
  if (keys.length > 32 || keys.some(key => typeof key !== 'string')) throw new Error('invalid');
  const values = fields(input, keys.filter((key): key is string => typeof key === 'string'));
  const copy: Record<string, string> = Object.create(null) as Record<string, string>;
  let bytes = 0;
  for (const [name, value] of Object.entries(values)) {
    const checked = headerValue(name, value);
    bytes += new TextEncoder().encode(name + checked).length;
    if (bytes > 8192 || Object.hasOwn(copy, name.toLowerCase())) throw new Error('invalid');
    copy[name.toLowerCase()] = checked;
  }
  new Headers(copy);
  return copy;
}
function baseUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048 || !/^https?:\/\/[^/?#\\\s]+\/?$/i.test(input)) throw new Error('invalid');
  const base = new URL(input);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/') throw new Error('invalid');
  return base.origin;
}
function timeout(input: unknown): number {
  const value = input === undefined ? 30_000 : input;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 30_000) throw new Error('invalid');
  return value;
}
function fetchFunction(value: unknown): value is typeof fetch { return typeof value === 'function'; }
export function configuration(input: InputTransferOptions): Configuration {
  try {
    const data = fields(input, ['baseUrl', 'fetch', 'headers', 'timeoutMs']);
    const fetcher: unknown = data.fetch === undefined ? globalThis.fetch : data.fetch;
    if (!fetchFunction(fetcher)) throw new Error('invalid');
    return { base: baseUrl(data.baseUrl), timeout: timeout(data.timeoutMs), fetch: fetcher, headers: headers(data.headers) };
  } catch { throw new Error('Invalid transfer options'); }
}
function lifecycle(value: InputRecord): boolean {
  if (value.offset > value.bytes || value.name.trim() !== value.name || !value.name.trim()) return false;
  if (['publishing', 'published'].includes(value.state) && value.offset !== value.bytes) return false;
  return value.state === 'failed' ? value.reason !== null : value.state === 'deleting' || value.reason === null;
}
function record(input: unknown): InputRecord {
  const data = fields(input, ['id', 'scope', 'folderId', 'name', 'sha256', 'bytes', 'offset', 'version', 'state', 'reason']);
  data.scope = fields(data.scope, ['kind', 'organizationId', 'workspaceId']);
  const copy: unknown = JSON.parse(encodeJson(data, 4096));
  const checked = validateApi('InputRecord', copy);
  if (!checked.ok) throw new Error('invalid');
  const value = checked.value;
  const ids = [value.id, value.folderId, value.scope.organizationId, value.scope.workspaceId];
  if (ids.some(id => id !== id.toLowerCase()) || !lifecycle(value)) throw new Error('invalid');
  return value;
}
export function signal(input: unknown): AbortSignal | undefined {
  if (input === undefined) return undefined;
  if (!(input instanceof AbortSignal)) throw new Error('invalid');
  return AbortSignal.any([input]);
}
function chunk(input: unknown): Uint8Array<ArrayBuffer> {
  if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype) throw new Error('invalid');
  const length: unknown = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length')?.get?.call(input);
  if (typeof length !== 'number' || length < 1 || length > INPUT_CHUNK_BYTES) throw new Error('invalid');
  const copy = new Uint8Array(length);
  Uint8Array.prototype.set.call(copy, input);
  return copy;
}
function fits(value: InputRecord, offset: number, length: number): boolean {
  return offset + length <= value.bytes && (offset === value.offset || offset + length <= value.offset);
}
function appendFields(data: Record<string, unknown>, value: InputRecord): Pick<Intent, 'offset' | 'chunk'> {
  if (value.state !== 'staging' || value.reason !== null) throw new Error('invalid');
  const offset = data.offset;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > value.offset) throw new Error('invalid');
  const body = chunk(data.chunk);
  if (!fits(value, offset, body.length)) throw new Error('invalid');
  if (offset === value.offset && value.version === Number.MAX_SAFE_INTEGER) throw new Error('invalid');
  return { offset, chunk: body };
}
export function intent(input: unknown, append: boolean): Intent {
  const data = fields(input, append ? ['record', 'signal', 'offset', 'chunk'] : ['record', 'signal']);
  const value = record(data.record);
  if (!append && value.state !== 'published') throw new Error('invalid');
  return { record: value, signal: signal(data.signal), ...(append ? appendFields(data, value) : { offset: 0, chunk: undefined }) };
}
export function path(value: InputRecord,append:boolean,offset:number): string {
  const params={organizationId:value.scope.organizationId,workspaceId:value.scope.workspaceId,inputId:value.id};
  return append?inputChunkPath(params,offset):inputContentPath(params);
}
