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
  const { journal, readRange, monotonicNow = () => performance.now() } = options;
  async function run<T>(key: Scope, operation: Operation, work: (key: Readonly<Scope>, budget: Budget) => Promise<T>): Promise<T> {
    if (active >= 2) throw new OutputTransferError('busy');
    active++; let budget: Budget | undefined;
    try {
      const captured = scope(key); budget = new Budget(operation, monotonicNow);
      return await work(captured, budget);
    } finally { budget?.finish(); active--; }
  }
  return Object.freeze({
    source: (key, operation) => run(key, operation, async (captured, budget) => (await readSource(journal, captured, budget)).envelope),
    chunk: (key, input, operation) => run(key, operation, async (captured, budget) => {
      const expected = request(input); const { source, envelope } = await readSource(journal, captured, budget);
      if (expected.manifestDigest !== envelope.manifest.manifestDigest || expected.sourceDigest !== envelope.sourceDigest) throw new OutputTransferError('conflict');
      const artifact = declaredArtifact(executionArtifacts(envelope.manifest.result), expected);
      const bytes = await readBytes(readRange, { root: source.root, artifact, offset: expected.offset, length: expected.length,
        deadline: budget.deadline, signal: budget.signal }, budget);
      budget.check(); return chunkValue(expected, artifact.bytes, bytes);
    }),
  } satisfies OutputSourceReader);
};
