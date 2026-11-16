import type { FastifyRequest } from 'fastify';
import { ApiFault } from '../api-errors.js';
import {INPUT_CHUNK_BYTES} from '@beetle/contracts/api';

import { header } from '../byte-content.js';
export { header } from '../byte-content.js';

export function uploadHeaders(request: FastifyRequest): void {
  if (header(request, 'content-type')?.toLowerCase() !== 'application/octet-stream' ||
    header(request, 'content-encoding') !== undefined) throw new ApiFault('malformed_request');
  const length = header(request, 'content-length');
  if (length === undefined) return;
  if (!/^[1-9][0-9]{0,15}$/.test(length)) throw new ApiFault('malformed_request');
  if (Number(length) > INPUT_CHUNK_BYTES) throw new ApiFault('body_limit');
}
export function contentHeaders(request: FastifyRequest): void {
  if (request.raw.httpVersion !== '1.1' || header(request, 'transfer-encoding') !== undefined ||
    ![undefined, '0'].includes(header(request, 'content-length'))) throw new ApiFault('malformed_request');
  header(request, 'range'); header(request, 'if-range');
}
