import { nativeCustody, NativeCustodyError } from '../native-custody/index.js';
import { OutputLifetime, OutputFailure, nodePorts } from '../output/index.js';
import type { OutputPorts, OutputCollectionReason, OutputIO } from '../output/index.js';
import { PrefixFiles } from './files.js';
import { captureOptions, captureStoppedOptions } from './options.js';
import { liveMetricSubsetText } from '@beetle/contracts/api';
import { historyHash, StoppedSlots } from './stopped-slots.js';
import type { CollectionRootIdentity } from '../root/index.js';
import { scan } from './scan.js';
import type { CapturedOptions, PrefixReadOptions, StoppedPrefixReadOptions } from './options.js';
import type { PrefixHistory } from './scan.js';
export type { PrefixReadOptions, PrefixHistory, StoppedPrefixReadOptions };
export interface PrefixRead {
  readonly result: Promise<{ ok: true; value: PrefixHistory } | { ok: false; reason: OutputCollectionReason }>;
  readonly quiesced: Promise<void>;
  close(): Promise<void>;
}
/** Advisory read only; caller owns active-attempt/epoch approval before and after IO. */
export function readLiveHistory(input: PrefixReadOptions, ports: OutputPorts = nodePorts): PrefixRead {
  return runRead(
    () => captureOptions(input, ports.now()),
    async (options) => ({ options }),
    ports,
  );
}
/** Caller owns the stopped producer proof and admission scope; availability grants no result authority. */
export function readStoppedHistory(input: StoppedPrefixReadOptions, ports: OutputPorts = nodePorts): PrefixRead {
  return runRead(
    () => captureStoppedOptions(input, ports.now()),
    async (options, io) => {
      const slots = new StoppedSlots(options, ports, io);
      const prefix = await slots.select();
      const { scope, producerEpoch, subset } = options.approval;
      return {
        options: {
          ...options,
          prefix,
          scope,
          producerEpoch,
          subset,
          subsetDigest: historyHash(liveMetricSubsetText(subset)),
        },
        stoppedRoot: options.root,
        check: () => slots.check(),
      };
    },
    ports,
  );
}
type Selected = { options: CapturedOptions; stoppedRoot?: CollectionRootIdentity; check?: () => Promise<void> };
function runRead<O extends { directory: string; deadline: number; signal?: AbortSignal }>(
  capture: () => O,
  select: (options: O, io: OutputIO) => Promise<Selected>,
  ports: OutputPorts,
): PrefixRead {
  const lease = nativeCustody.reserve('range');
  if (!lease) {
    const closed = Promise.resolve();
    return { result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: closed, close: () => closed };
  }
  const owner = new OutputLifetime<{ ok: true; value: PrefixHistory }>(ports, () => lease.release());
  lease.own(owner);
  let files: PrefixFiles;
  let selected: Selected;
  owner.start(
    () => {
      const options = capture();
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
      selected = await select(options, owner);
      files = new PrefixFiles(
        { ...selected.options, ...(selected.stoppedRoot ? { stoppedRoot: selected.stoppedRoot } : {}) },
        ports,
        owner,
      );
      await files.open();
      const value = await scan(files, selected.options, owner);
      await files.check();
      owner.check();
      return { ok: true, value };
    },
    async () => {
      await files.check(true);
      await selected.check?.();
    },
  );
  return owner.public;
}
