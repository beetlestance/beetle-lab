import type { FastifyRequest } from 'fastify';
import { ApiFault } from '../api-errors.js';

export function header(request: FastifyRequest, name: string): string | undefined {
  let found: string | undefined;
  const raw = request.raw.rawHeaders;
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]!.toLowerCase() !== name) continue;
    if (found !== undefined) throw new ApiFault('malformed_request');
    found = raw[index + 1]!;
  }
  return found;
}
export function uploadHeaders(request: FastifyRequest): void {
  if (header(request, 'content-type')?.toLowerCase() !== 'application/octet-stream' ||
    header(request, 'content-encoding') !== undefined) throw new ApiFault('malformed_request');
  const length = header(request, 'content-length');
  if (length === undefined) return;
  if (!/^[1-9][0-9]{0,15}$/.test(length)) throw new ApiFault('malformed_request');
  if (Number(length) > 65_536) throw new ApiFault('body_limit');
}
export function contentHeaders(request: FastifyRequest): void {
  if (request.raw.httpVersion !== '1.1' || header(request, 'transfer-encoding') !== undefined ||
    ![undefined, '0'].includes(header(request, 'content-length'))) throw new ApiFault('malformed_request');
  header(request, 'range'); header(request, 'if-range');
}
