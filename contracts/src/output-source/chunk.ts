import { validate } from '../validate.js';
import type { SourceChunk, SourceChunkRequest } from '../generated/types.js';
import { capture, canonical, checked, freeze, requireInput } from './capture.js';
import { integer } from './shape.js';
import { SOURCE_BASE64_CHARACTERS, SOURCE_CHUNK_BYTES, SOURCE_CHUNK_REQUEST_BYTES } from './wire-limits.js';
import type { Owned } from './types.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Check canonical padding/unused bits and decoded size before any byte allocation. */
function decodedBytes(text: string): number {
  requireInput(text.length <= SOURCE_BASE64_CHARACTERS && text.length % 4 === 0);
  if (text.length === 0) return 0;
  const padding = text.endsWith('==') ? 2 : Number(text.endsWith('='));
  const end = text.length - padding;
  for (let index = 0; index < end; index++) requireInput(alphabet.includes(text[index]!));
  const tail = alphabet.indexOf(text[end - 1]!);
  if (padding === 2) requireInput((tail & 15) === 0);
  if (padding === 1) requireInput((tail & 3) === 0);
  return text.length / 4 * 3 - padding;
}

/** Input must already have bounded producer/parsed-byte provenance. */
export function captureSourceChunkRequest(input: unknown): Owned<SourceChunkRequest> {
  return checked(() => {
    const captured = capture(input, SOURCE_CHUNK_REQUEST_BYTES);
    canonical(captured, SOURCE_CHUNK_REQUEST_BYTES);
    const result = validate('SourceChunkRequest', captured); requireInput(result.ok);
    return freeze(result.value);
  });
}

/** Validate the exact requested range against its adopted manifest declaration. */
export function verifySourceChunk(input: unknown, request: SourceChunkRequest, artifactBytes: number): Owned<SourceChunk> {
  return checked(() => {
    const expected = captureSourceChunkRequest(request); integer(artifactBytes);
    requireInput(expected.offset <= artifactBytes);
    const captured = capture(input, SOURCE_CHUNK_BYTES); canonical(captured, SOURCE_CHUNK_BYTES);
    const result = validate('SourceChunk', captured); requireInput(result.ok);
    const value = result.value;
    for (const field of ['manifestDigest', 'sourceDigest', 'artifactId', 'offset'] as const) {
      requireInput(value[field] === expected[field]);
    }
    const bytes = decodedBytes(value.base64);
    requireInput(bytes === Math.min(expected.length, artifactBytes - expected.offset));
    requireInput(value.totalBytes === artifactBytes);
    requireInput(value.nextOffset === expected.offset + bytes);
    requireInput(value.eof === (value.nextOffset === artifactBytes));
    return freeze(value);
  });
}
