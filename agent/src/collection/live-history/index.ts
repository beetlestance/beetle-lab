import { nativeCustody, NativeCustodyError } from '../native-custody/index.js';
import { OutputLifetime, OutputFailure, nodePorts } from '../output/index.js';
import type { OutputPorts, OutputCollectionReason } from '../output/index.js';
import { PrefixFiles } from './files.js';
import { captureOptions } from './options.js';
import { scan } from './scan.js';
import type { PrefixReadOptions } from './options.js';
import type { PrefixHistory } from './scan.js';
export type { PrefixReadOptions, PrefixHistory };
export interface PrefixRead {
  readonly result: Promise<{ ok: true; value: PrefixHistory } | { ok: false; reason: OutputCollectionReason }>;
  readonly quiesced: Promise<void>;
  close(): Promise<void>;
}
/** Advisory read only; caller owns active-attempt/epoch approval before and after IO. */
export function readLiveHistory(input: PrefixReadOptions, ports: OutputPorts = nodePorts): PrefixRead {
  const lease = nativeCustody.reserve('range');
  if (!lease) {
    const closed = Promise.resolve();
    return { result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: closed, close: () => closed };
  }
  const owner = new OutputLifetime<{ ok: true; value: PrefixHistory }>(ports, () => lease.release());
  lease.own(owner);
  let files: PrefixFiles;
  owner.start(
    () => {
      const options = captureOptions(input, ports.now());
      try {
        lease.bind(options.directory);
      } catch (error) {
        throw new OutputFailure(
          error instanceof NativeCustodyError && error.reason === 'busy' ? 'busy' : 'invalid_options',
        );
      }
      return options;
    },
    async (options) => {
      files = new PrefixFiles(options, ports, owner);
      await files.open();
      const value = await scan(files, options, owner);
      await files.check();
      owner.check();
      return { ok: true, value };
    },
    () => files.check(true),
  );
  return owner.public;
}
