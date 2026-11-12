import type { OutputCollection, OutputCollectionOptions, OutputCollectionResult } from './types.js';
import { snapshotOptions } from './budget.js';
import { nodePorts } from './ports.js';
import type { OutputPorts } from './ports.js';
import { OutputFiles } from './files.js';
import { OutputLifetime } from './lifetime.js';
import { verifyOutputs } from './verify.js';

// Strong custody and native admission share one bounded owner set.
const owners = new Set<OutputLifetime<Extract<OutputCollectionResult, { ok: true }>>>();
function busy(): OutputCollection {
  const closed = Promise.resolve();
  return { result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: closed, close: () => closed };
}
/** Private fault seam; the public collector always supplies production Node ports. */
export function startCollection(input: OutputCollectionOptions, ports: OutputPorts = nodePorts): OutputCollection {
  if (owners.size >= 2) return busy();
  const owner = new OutputLifetime<Extract<OutputCollectionResult, { ok: true }>>(ports, () => { owners.delete(owner); });
  owners.add(owner);
  let files: OutputFiles;
  owner.start(() => snapshotOptions(input), async options => {
    files = new OutputFiles(options, ports, owner);
    return { ok: true, ...await verifyOutputs(options, files, owner) };
  }, () => files.namedCheck());
  return owner.public;
}
