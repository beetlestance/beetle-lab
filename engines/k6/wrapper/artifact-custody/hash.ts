import { createHash } from 'node:crypto';
import { AttemptError } from '../failure/index.js';
interface ReadFile {read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{bytesRead: number}>}
interface HashOptions {readonly file: ReadFile; readonly bytes: number; readonly maximumBytes: number; readonly check: () => void}
/** Bounded positional digest only; caller owns file/root identity and close proof. */
export async function hashArtifactFile(options: HashOptions): Promise<string> {
  const {bytes, maximumBytes, check} = options;
  requireAllowance(bytes, maximumBytes);
  check(); const read = options.file.read.bind(options.file); const buffer = new Uint8Array(65536); const hash = createHash('sha256');
  const limit = Math.ceil(bytes / buffer.length) + 32;
  for (let offset = 0, calls = 0; offset < bytes;) {
    if (++calls > limit) throw new AttemptError('artifact');
    const length = Math.min(buffer.length, bytes - offset); check();
    const result = await read(buffer, 0, length, offset); check();
    if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead < 1 || result.bytesRead > length) throw new AttemptError('artifact');
    hash.update(buffer.subarray(0, result.bytesRead)); offset += result.bytesRead;
  }
  check(); const tail = await read(buffer, 0, 1, bytes); check();
  if (tail.bytesRead !== 0) throw new AttemptError('artifact'); return hash.digest('hex');
}

function requireAllowance(bytes: number, maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 256 * 1048576
    || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumBytes || Object.is(bytes, -0)) throw new AttemptError('artifact');
}
