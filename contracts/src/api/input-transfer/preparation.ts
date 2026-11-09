import type { InputTransferResult, PreparedInputBytes } from '../input-transfer-types.js';
import { hash } from './integrity.js';
import type { Operation } from './lifetime.js';
import { fields, signal } from './snapshot.js';

interface Preparation { file: Blob; size: number; signal: AbortSignal | undefined }
export function preparation(input: unknown): Preparation {
  const data = fields(input, ['file', 'signal']);
  if (!(data.file instanceof Blob)) throw new Error('invalid');
  const size: unknown = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get?.call(data.file);
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > 8_388_608) throw new Error('invalid');
  return { file: data.file, size, signal: signal(data.signal) };
}
export async function prepare(owner: Operation, request: Preparation): Promise<InputTransferResult<PreparedInputBytes>> {
  try {
    owner.check();
    const buffer = await Blob.prototype.arrayBuffer.call(request.file);
    owner.check();
    if (!(buffer instanceof ArrayBuffer)) throw new Error('buffer');
    const content = new Uint8Array(buffer);
    if (content.length !== request.size) throw new Error('length');
    const sha256 = await hash(owner, content);
    return { ok: true, value: { sha256, content } };
  } catch { return { ok: false, issued: false, error: owner.failure('transport') }; }
}
