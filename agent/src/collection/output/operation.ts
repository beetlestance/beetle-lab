import { nativeCustody, NativeCustodyError } from '../native-custody/index.js';
import type { OutputCollection, OutputCollectionOptions, OutputCollectionResult } from './types.js';
import { snapshotOptions } from './budget.js';
import { nodePorts } from './ports.js';
import { OutputFailure } from './ports.js';
import type { OutputPorts } from './ports.js';
import { OutputFiles } from './files.js';
import { OutputLifetime } from './lifetime.js';
import { verifyOutputs } from './verify.js';

function busy(): OutputCollection {
  const closed = Promise.resolve();
  return { result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: closed, close: () => closed };
}
/** Private fault seam; the public collector always supplies production Node ports. */
export function startCollection(input: OutputCollectionOptions, ports: OutputPorts = nodePorts): OutputCollection {
  const lease = nativeCustody.reserve('collection'); if (!lease) return busy();
  const owner = new OutputLifetime<Extract<OutputCollectionResult, { ok: true }>>(ports, () => { lease.release(); });
  lease.own(owner);
  let files: OutputFiles;
  owner.start(() => {
    const options = snapshotOptions(input);
    try { lease.bind(options.directory); }
    catch (error) { throw new OutputFailure(error instanceof NativeCustodyError && error.reason === 'busy' ? 'busy' : 'invalid_options'); }
    return options;
  }, async options => {
    files = new OutputFiles(options, ports, owner);
    return { ok: true, ...await verifyOutputs(options, files, owner) };
  }, () => files.namedCheck());
  return owner.public;
}
