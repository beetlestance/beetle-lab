import { INPUT_CHUNK_BYTES } from '../../../../ports/inputs.js';
import type { InputContentRange, InputContentSink } from '../../../../ports/input-bytes.js';
import type { CapturedInput } from './capture.js';
import { requireState, validateRange } from './capture.js';
import type { Directories } from './directories.js';
import { InputFile } from './file.js';
import type { Roots } from './identity.js';
import { fail } from './job.js';

export async function read(tree: Directories, roots: Roots, input: CapturedInput,
  response: { range: InputContentRange; sink: InputContentSink }): Promise<void> {
  requireState(input, 'published'); validateRange(response.range, input.bytes);
  const location = await tree.location(roots.published, input, false);
  const file = await InputFile.open(tree, location, false); if (!file) fail('custody_missing');
  file.requireLinks(1n); await file.verifyContent(input);
  let position = response.range.start;
  while (position < response.range.endExclusive) {
    const bytes = await file.read(position, Math.min(INPUT_CHUNK_BYTES, response.range.endExclusive - position));
    await response.sink.write(bytes); tree.owner.check(); await file.verify(); position += bytes.byteLength;
  }
  await file.verify();
}
