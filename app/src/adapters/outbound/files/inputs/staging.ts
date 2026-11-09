import { INPUT_CHUNK_BYTES } from '../../../../ports/inputs.js';
import type { InputChunkSource } from '../../../../ports/input-bytes.js';
import type { CapturedInput } from './capture.js';
import { requireState } from './capture.js';
import type { Directories, Location } from './directories.js';
import { InputFile } from './file.js';
import type { Roots } from './identity.js';
import { fail } from './job.js';

async function stagingFile(tree: Directories, location: Location, input: CapturedInput): Promise<InputFile> {
  let file = await InputFile.open(tree, location, true);
  if (!file) {
    if (input.offset !== 0) fail('custody_missing');
    file = await InputFile.create(tree, location);
  }
  file.requireLinks(1n);
  if (file.size < BigInt(input.offset)) fail('integrity');
  if (file.size > BigInt(input.offset)) await file.truncate(input.offset);
  await file.sync(); await tree.sync(location.parent); return file;
}
export async function prepare(tree: Directories, roots: Roots, input: CapturedInput): Promise<void> {
  requireState(input, 'staging');
  const location = await tree.location(roots.stage, input, true);
  await stagingFile(tree, location, input); await tree.check();
}
async function compare(file: InputFile, bytes: Uint8Array, offset: number): Promise<void> {
  let compared = 0;
  while (compared < bytes.byteLength) {
    const current = await file.read(offset + compared, bytes.byteLength - compared);
    for (let index = 0; index < current.byteLength; index++) {
      if (current[index] !== bytes[compared + index]) fail('integrity');
    }
    compared += current.byteLength;
  }
}
async function captureChunk(tree: Directories, source: InputChunkSource): Promise<Uint8Array> {
  await tree.check();
  const supplied = await source(); tree.owner.check();
  if (!(supplied instanceof Uint8Array) || supplied.byteLength < 1 || supplied.byteLength > INPUT_CHUNK_BYTES) fail('invalid_input');
  return Uint8Array.from(supplied);
}
export async function append(tree: Directories, roots: Roots, input: CapturedInput,
  request: { offset: number; source: InputChunkSource }): Promise<number> {
  requireState(input, 'staging');
  if (!Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > input.offset) fail('invalid_input');
  const bytes = await captureChunk(tree, request.source);
  const end = request.offset + bytes.byteLength;
  if (end > input.bytes || (request.offset < input.offset && end > input.offset)) fail('invalid_input');
  const location = await tree.location(roots.stage, input, true);
  const file = await stagingFile(tree, location, input);
  if (request.offset < input.offset) { await compare(file, bytes, request.offset); return input.offset; }
  await tree.reserve(bytes.byteLength); await file.write(bytes, input.offset);
  await tree.check(); return end;
}
