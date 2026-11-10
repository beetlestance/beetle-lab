import type { OutputCollection, OutputCollectionOptions, OutputCollectionResult } from './types.js';
import { snapshotOptions } from './budget.js';
import { nodePorts } from './ports.js';
import type { OutputPorts } from './ports.js';
import { OutputFiles } from './files.js';
import { OutputLifetime } from './lifetime.js';
import { verifyOutputs } from './verify.js';

let active = 0;
function busy(): OutputCollection {
  const closed = Promise.resolve();
  return { result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: closed, close: () => closed };
}
/** Private fault seam; the public collector always supplies production Node ports. */
export function startCollection(input: OutputCollectionOptions, ports: OutputPorts = nodePorts): OutputCollection {
  if (active >= 2) return busy();
  active++;
  const owner = new OutputLifetime<Extract<OutputCollectionResult, { ok: true }>>(ports, () => { active--; });
  let files: OutputFiles;
  owner.start(() => snapshotOptions(input), async options => {
    files = new OutputFiles(options, ports, owner);
    return { ok: true, ...await verifyOutputs(options, files, owner) };
  }, () => files.namedCheck());
  return owner.public;
}
