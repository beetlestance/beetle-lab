import type { IncomingMessage } from 'node:http';

const maximumBytes = 1_048_576;

function countHeaders(response: IncomingMessage): void {
  if (response.rawHeaders.length > 64) throw new Error();
  const seen = new Set<string>();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index]!.toLowerCase();
    if (seen.has(name)) throw new Error();
    seen.add(name);
  }
}

function contentLength(length: string | undefined): number | undefined {
  if (length === undefined) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maximumBytes) throw new Error();
  return Number(length);
}

function headers(response: IncomingMessage): number | undefined {
  countHeaders(response);
  const length = response.headers['content-length'];
  const transfer = response.headers['transfer-encoding'];
  const encoding = response.headers['content-encoding'];
  if (transfer !== undefined && (transfer !== 'chunked' || length !== undefined)) throw new Error();
  if (encoding !== undefined && encoding !== 'identity') throw new Error();
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers['content-type'] ?? '')) throw new Error();
  return contentLength(length);
}

/** Completion is data only; the native owner separately waits for close events. */
export function receiveJson(response: IncomingMessage, complete: (value: unknown) => void,
  fail: () => void): void {
  let expected: number | undefined;
  try { expected = headers(response); } catch { fail(); return; }
  const body = Buffer.allocUnsafe(maximumBytes);
  let size = 0;
  let fragments = 0;
  let failed = false;
  response.on('data', (chunk: Buffer) => {
    if (failed) return;
    if (++fragments > 4096 || size + chunk.byteLength > maximumBytes) {
      failed = true; fail(); return;
    }
    body.set(chunk, size); size += chunk.byteLength;
  });
  response.once('end', () => {
    if (failed) return;
    try {
      if (!response.complete || (expected !== undefined && expected !== size)) throw new Error();
      // Node exposes trailers only after EOF; runner JSON has no trailer semantics.
      if (response.rawTrailers?.length) throw new Error();
      complete(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, size))) as unknown);
    } catch { fail(); }
  });
}
