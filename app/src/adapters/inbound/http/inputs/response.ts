import type { FastifyReply } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { InputRecord } from '../../../../ports/inputs.js';
import type { InputContentRange } from '../../../../ports/input-bytes.js';
import { ResponseContractError } from '../schema-compilers.js';
export { writeContent } from '../byte-content.js';

export function checkedRecord(value: InputRecord): InputRecord {
  try {
    const snapshot: unknown = JSON.parse(encodeJson(value, 65_536));
    const checked = validateApi('InputRecord', snapshot);
    if (!checked.ok || checked.value.offset > checked.value.bytes) throw new ResponseContractError();
    return checked.value;
  } catch { throw new ResponseContractError(); }
}
export function beginContent(reply: FastifyReply, record: InputRecord, range: InputContentRange | undefined): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', ETag: `"${record.sha256}"`,
    'Content-Disposition': `attachment; filename="input-${record.id}.bin"`,
    ...(record.bytes ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': '0' }),
  };
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.endExclusive - 1}/${record.bytes}`;
  reply.hijack(); reply.raw.writeHead(range ? 206 : 200, headers);
}
