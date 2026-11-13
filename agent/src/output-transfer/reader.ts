import { ProducerGateError } from '../producer-gate/index.js';
import type { ProducerLease } from '../producer-gate/index.js';
import { executionArtifacts } from '@beetle/contracts';
import { performance } from 'node:perf_hooks';
import { captureSourceChunkRequest } from '@beetle/contracts/output-source';
import { copyControlScope } from '../control-protocol/index.js';
import type { Scope } from '../admission/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { CreateOutputSourceReader, OutputSourceReader } from './types.js';
import { Budget } from './budget.js';
import { OutputTransferError } from './errors.js';
import { declaredArtifact, readBytes, chunkValue } from './range.js';
import { readSource } from './source.js';

let active = 0;
function scope(input: Scope): Readonly<Scope> {
  try {
    const key = copyControlScope(input);
    if (key.generation !== 1) throw new Error();
    return key;
  } catch { throw new OutputTransferError('invalid_input'); }
}
function request(input: Parameters<OutputSourceReader['chunk']>[1]) {
  try { return captureSourceChunkRequest(input); }
  catch { throw new OutputTransferError('invalid_input'); }
}

export const createOutputSourceReader: CreateOutputSourceReader = options => {
  const { journal, gate, readRange, monotonicNow = () => performance.now() } = options;
  gate.assertOwner(journal.retirements);
  async function run<T>(key: Scope, operation: Operation, prepare: (key: Readonly<Scope>, budget: Budget, lease: ProducerLease) => () => Promise<T>): Promise<T> {
    if (active >= 2) throw new OutputTransferError('busy');
    active++; let budget: Budget | undefined; let lease: ProducerLease | undefined;
    try {
      const captured = scope(key); lease = gate.acquire(captured); budget = new Budget(operation, monotonicNow);
      const work = prepare(captured, budget, lease);
      await lease.ready(); budget.check();
      return await work();
    } catch (error) {
      if (error instanceof ProducerGateError) throw new OutputTransferError(error.reason === 'capacity' ? 'busy' : 'unavailable');
      throw error;
    } finally { budget?.finish(); if (!lease || lease.finish()) active--; }
  }
  return Object.freeze({
    source: (key, operation) => run(key, operation, (captured, budget) => async () => (await readSource(journal, captured, budget)).envelope),
    chunk: (key, input, operation) => run(key, operation, (captured, budget, lease) => {
      const expected = request(input);
      return async () => {
      const { source, envelope } = await readSource(journal, captured, budget);
      if (expected.manifestDigest !== envelope.manifest.manifestDigest || expected.sourceDigest !== envelope.sourceDigest) throw new OutputTransferError('conflict');
      const artifact = declaredArtifact(executionArtifacts(envelope.manifest.result), expected);
      const bytes = await readBytes(readRange, { root: source.root, artifact, offset: expected.offset, length: expected.length,
        deadline: budget.deadline, signal: budget.signal }, budget, lease);
      budget.check(); return chunkValue(expected, artifact.bytes, bytes);
      };
    }),
  } satisfies OutputSourceReader);
};
