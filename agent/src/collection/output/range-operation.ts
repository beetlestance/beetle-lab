import { OutputFiles } from './files.js';
import { OutputLifetime } from './lifetime.js';
import { nodePorts, OutputFailure } from './ports.js';
import type { OutputPorts } from './ports.js';
import { snapshotRange } from './range-budget.js';
import type { OutputRange, OutputRangeOptions, OutputRangeResult } from './range-types.js';

// Strong custody and native admission share one bounded owner set.
const owners = new Set<OutputLifetime<Extract<OutputRangeResult, { ok: true }>>>();
/** Private fault seam; range originals have an independent processwide bound. */
export function startRange(input: OutputRangeOptions, ports: OutputPorts = nodePorts): OutputRange {
  if (owners.size >= 2) {
    const closed = Promise.resolve();
    return { result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: closed, close: () => closed };
  }
  const owner = new OutputLifetime<Extract<OutputRangeResult, { ok: true }>>(ports, () => { owners.delete(owner); });
  owners.add(owner);
  let files: OutputFiles;
  owner.start(() => snapshotRange(input), async options => {
    files = new OutputFiles({ ...options.root, root: options.root }, ports, owner);
    const opened = await files.openOutput(options.artifact.relativePath);
    try {
      if (opened.file.stat.size !== BigInt(options.artifact.bytes)) throw new OutputFailure('integrity');
      const value = Buffer.alloc(Math.min(options.length, options.artifact.bytes - options.offset));
      let position = 0;
      while (position < value.length) position += await files.read(opened, value, position, options.offset + position);
      await files.finalCheck(); owner.check();
      return { ok: true, value: new Uint8Array(value.buffer, value.byteOffset, value.length) };
    } finally { await files.closeOutput(opened); }
  }, () => files.namedCheck());
  return owner.public;
}
