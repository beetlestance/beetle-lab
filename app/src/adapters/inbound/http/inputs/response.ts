import type { FastifyReply } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { InputRecord } from '../../../../ports/inputs.js';
import type { InputContentRange } from '../../../../ports/input-bytes.js';
import { ResponseContractError } from '../schema-compilers.js';
import { ApiFault } from '../api-errors.js';

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
/** Both the original write callback and drain (when needed) must finish. */
export function writeContent(reply: FastifyReply, chunk: Uint8Array, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let callbackDone = false; let drained = false; let done = false; let failure: Error | undefined;
    const cleanup = () => {
      reply.raw.removeListener('error', fail); reply.raw.removeListener('close', closed);
      reply.raw.removeListener('drain', drain); signal.removeEventListener('abort', closed);
    };
    const complete = () => {
      if (done || !callbackDone || !drained) return;
      done = true; cleanup();
      if (failure) reject(failure); else resolve();
    };
    const fail = (error: Error) => { failure ??= error; drained = true; complete(); };
    const closed = () => fail(new ApiFault('storage_unavailable'));
    const drain = () => { drained = true; complete(); };
    reply.raw.once('error', fail); reply.raw.once('close', closed);
    signal.addEventListener('abort', closed, { once: true });
    if (signal.aborted || reply.raw.destroyed) { callbackDone = true; closed(); return; }
    try {
      const accepted = reply.raw.write(chunk, error => {
        callbackDone = true;
        if (error) fail(error); else complete();
      });
      if (accepted) drained = true;
      else if (!failure) reply.raw.once('drain', drain);
    } catch { callbackDone = true; fail(new ApiFault('storage_unavailable')); }
    complete();
  });
}
