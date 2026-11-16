import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiFault } from './api-errors.js';
import type { InputContentRange } from '../../../ports/input-bytes.js';

function bounds(first: string, last: string, size: number): InputContentRange | false {
  if (first === '') {
    const suffix = Number(last);
    return suffix > 0 ? { start: Math.max(0, size - suffix), endExclusive: size } : false;
  }
  const start = Number(first);
  const endExclusive = last === '' ? size : Math.min(size, Number(last) + 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endExclusive) || start >= endExclusive || start >= size) return false;
  return { start, endExclusive };
}
export function selectRange(text: string | undefined, size: number): InputContentRange | undefined | false {
  if (text === undefined) return undefined;
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(text);
  if (!match || !size) return false;
  return bounds(match[1]!, match[2]!, size);
}
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
