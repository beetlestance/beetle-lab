import {constants} from 'node:fs';
import type {Stats} from 'node:fs';
import {open} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
function regularSource(info: Stats, maximum: number): void {
  if (!info.isFile() || info.nlink !== 1 || info.size > maximum) throw Error('Source report file bound');
}
async function copyBytes(input: FileHandle, output: FileHandle, maximum: number): Promise<number> {
  const buffer = Buffer.alloc(65536); let bytes = 0;
  while (true) {
    const {bytesRead} = await input.read(buffer, 0, buffer.length, null);
    if (!bytesRead) return bytes;
    if (bytesRead > maximum - bytes) throw Error('Source report stream bound');
    let offset = 0;
    while (offset < bytesRead) {
      const {bytesWritten} = await output.write(buffer, offset, bytesRead - offset, null);
      if (!bytesWritten) throw Error('Source report write stalled'); offset += bytesWritten;
    }
    bytes += bytesRead;
  }
}
/** No-follow regular source and exclusive destination; count bytes before writing,
 * then join both original closes before accepting a copy. */
export async function copySourceReport(source: string, destination: string, remaining: number): Promise<number> {
  const maximum = Math.min(5 * 1024 ** 2, remaining);
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw Error('Source report aggregate bound');
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let output: Awaited<ReturnType<typeof open>> | undefined; let bytes = 0; let failure: {error: unknown} | undefined;
  try {
    const info = await input.stat();
    regularSource(info, maximum);
    output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    bytes = await copyBytes(input, output, maximum);
    if (bytes !== info.size) throw Error('Source report changed');
  } catch (error) {failure = {error};}
  const closed = await Promise.allSettled([input.close(), output?.close()]);
  const errors = closed.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
  if (failure) errors.unshift(failure.error);
  if (errors.length) throw new AggregateError(errors, 'Source report copy failed'); return bytes;
}
