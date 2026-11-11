import { TARGET_RUNTIME_REPORT_BYTES } from '@beetle/contracts/target-runtime';
interface BodyState {readonly buffer: Uint8Array; bytes: number; fragments: number}
function bodyBuffer(expected: number): BodyState {
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > TARGET_RUNTIME_REPORT_BYTES) throw new Error('Target report body limit');
  return {buffer: new Uint8Array(expected), bytes: 0, fragments: 0};
}
function append(state: BodyState, chunk: unknown): void {
  if (!(chunk instanceof Uint8Array) || ++state.fragments > 4096 || chunk.byteLength > state.buffer.length - state.bytes) throw new Error('Target report body limit');
  state.buffer.set(chunk, state.bytes); state.bytes += chunk.byteLength;
}
/** One browser stream original; cancellation and lock cleanup are awaited before return. */
export async function targetBody(response: Response, expected: number, signal: AbortSignal): Promise<Uint8Array> {
  const state = bodyBuffer(expected);
  if (!response.body) throw new Error('Target report unavailable');
  const reader = response.body.getReader(); const closed = reader.closed.then(() => true, () => false);
  let cancellation: Promise<boolean> | undefined;
  const cancel = () => {cancellation ??= reader.cancel().then(() => true, () => false);};
  signal.addEventListener('abort', cancel, {once: true});
  try {
    headers(response, expected);
    if (signal.aborted) cancel();
    while (!signal.aborted) {
      const chunk = await reader.read(); if (chunk.done) break;
      append(state, chunk.value);
    }
    if (signal.aborted || state.bytes !== expected) throw new Error('Target report incomplete');
    return state.buffer;
  } finally {
    signal.removeEventListener('abort', cancel); cancel();
    await release(reader, cancellation!, closed);
  }
}
async function release(reader: ReadableStreamDefaultReader<Uint8Array>, cancellation: Promise<boolean>, closed: Promise<boolean>): Promise<void> {
  const [cancelled, ended] = await Promise.all([cancellation, closed]);
  reader.releaseLock();
  if (!cancelled || !ended) throw new Error('Target report cleanup failed');
}
function headers(response: Response, expected: number): void {
  if (response.status !== 200 || response.redirected) throw new Error('Target report unavailable');
  const encoding = response.headers.get('content-encoding');
  const advertised = response.headers.get('content-length');
  if ((!encoding || encoding === 'identity') && advertised !== null
    && (!/^[0-9]{1,8}$/.test(advertised) || Number(advertised) !== expected)) throw new Error('Target report length mismatch');
}
