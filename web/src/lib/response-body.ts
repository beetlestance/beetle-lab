interface BodyState {readonly buffer: Uint8Array; bytes: number; fragments: number}
interface BodyLimit {readonly maximum: number; readonly expected?: number}
function bodyBuffer(limit: BodyLimit): BodyState {
  if (!Number.isSafeInteger(limit.maximum) || limit.maximum < 1 || limit.maximum > 1048576
    || limit.expected !== undefined && (!Number.isSafeInteger(limit.expected) || limit.expected < 1 || limit.expected > limit.maximum)) throw new Error('Response body limit');
  return {buffer: new Uint8Array(limit.expected ?? limit.maximum), bytes: 0, fragments: 0};
}
function append(state: BodyState, chunk: unknown): void {
  if (!(chunk instanceof Uint8Array) || ++state.fragments > 4096 || chunk.byteLength > state.buffer.length - state.bytes) throw new Error('Response body limit');
  state.buffer.set(chunk, state.bytes); state.bytes += chunk.byteLength;
}
/** One finite browser stream; retain original cancellation/closed/lock cleanup. */
export async function responseBody(response: Response, limit: BodyLimit, signal: AbortSignal): Promise<Uint8Array> {
  const state = bodyBuffer(limit);
  if (!response.body) throw new Error('Response body unavailable');
  const reader = response.body.getReader(); const closed = reader.closed.then(() => true, () => false);
  let cancellation: Promise<boolean> | undefined;
  const cancel = () => {cancellation ??= reader.cancel().then(() => true, () => false);};
  signal.addEventListener('abort', cancel, {once: true});
  try {
    const advertised = headers(response, limit);
    if (signal.aborted) cancel();
    while (!signal.aborted) {
      const chunk = await reader.read(); if (chunk.done) break;
      append(state, chunk.value);
    }
    const expected = limit.expected ?? advertised;
    if (signal.aborted || expected !== undefined && state.bytes !== expected) throw new Error('Response body incomplete');
    return state.buffer.subarray(0, state.bytes);
  } finally {
    signal.removeEventListener('abort', cancel); cancel();
    await release(reader, cancellation!, closed);
  }
}
async function release(reader: ReadableStreamDefaultReader<Uint8Array>, cancellation: Promise<boolean>, closed: Promise<boolean>): Promise<void> {
  const [cancelled, ended] = await Promise.all([cancellation, closed]); reader.releaseLock();
  if (!cancelled || !ended) throw new Error('Response body cleanup failed');
}
function headers(response: Response, limit: BodyLimit): number | undefined {
  if (response.status !== 200 || response.redirected) throw new Error('Response unavailable');
  const encoding = response.headers.get('content-encoding'); const length = response.headers.get('content-length');
  if (encoding && encoding !== 'identity' || length === null) return undefined;
  if (!/^[0-9]{1,8}$/.test(length)) throw new Error('Response length mismatch');
  const bytes = Number(length);
  if (bytes > limit.maximum || limit.expected !== undefined && bytes !== limit.expected) throw new Error('Response length mismatch');
  return bytes;
}
