import type { InputByteContext, InputByteJob, InputByteStore } from '../../../../ports/input-bytes.js';
import type { InputRecord } from '../../../../ports/inputs.js';
import { capture, captureRange } from './capture.js';
import type { CapturedInput } from './capture.js';
import { read } from './content.js';
import { Directories } from './directories.js';
import { pinRoots } from './identity.js';
import { safeError, startJob } from './job.js';
import type { NativePort } from './native.js';
import { publish } from './publication.js';
import { remove } from './removal.js';
import { append, prepare } from './staging.js';

/** Internal constructor for controlled native original/failure tests. */
export async function openStore(options: { stagingRoot: string; publishedRoot: string }, port: NativePort): Promise<InputByteStore> {
  let roots;
  try { roots = await pinRoots(port, options.stagingRoot, options.publishedRoot); }
  catch (error) { throw safeError(error); }
  const pinned = roots;
  function job<T>(record: InputRecord, context: InputByteContext,
    work: (tree: Directories, input: CapturedInput) => Promise<T>): InputByteJob<T> {
    let input: CapturedInput;
    try { input = capture(record); }
    catch (error) { return startJob(port, context, async () => { throw safeError(error); }); }
    return startJob(port, context, async owner => {
      const tree = new Directories(owner, pinned); await tree.check(); return work(tree, input);
    });
  }
  return {
    prepare: (record, context) => job(record, context, (tree, input) => prepare(tree, pinned, input)),
    append: (record, offset, source, context) => job(record, context, (tree, input) => append(tree, pinned, input, { offset, source })),
    publish: (record, context) => job(record, context, (tree, input) => publish(tree, pinned, input)),
    remove: (record, context) => job(record, context, (tree, input) => remove(tree, pinned, input)),
    read: (record, range, sink, context) => {
      const captured = captureRange(range);
      return job(record, context, (tree, input) => read(tree, pinned, input, { range: captured, sink }));
    },
  };
}
