import { createHash } from 'node:crypto';
import { verifyEngineResultSeal } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { CONTROL_FILE } from '../../control-protocol/index.js';
import { OUTPUT_READ_BYTES, OUTPUT_RESULT_FILE } from './types.js';
import { accountedBytes } from './budget.js';
import type { OutputSnapshot } from './budget.js';
import { OutputFailure } from './ports.js';
import type { OutputIO } from './ports.js';
import type { OutputFiles } from './files.js';

function sealed(input: unknown): Readonly<EngineResult> {
  const result = verifyEngineResultSeal(input, text => createHash('sha256').update(text).digest('hex'));
  if (!result.ok) throw new OutputFailure('result');
  return result.value;
}
function scope(result: Readonly<EngineResult>, options: OutputSnapshot): void {
  for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) {
    if (result[key] !== options.key[key]) throw new OutputFailure('result');
  }
  if (result.engineId !== options.engineId) throw new OutputFailure('result');
}
function conflict(a: string, b: string): boolean { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
function inventory(result: Readonly<EngineResult>): void {
  const ids = new Set<string>(); const paths = [OUTPUT_RESULT_FILE, CONTROL_FILE];
  for (const artifact of result.artifacts) {
    const id = artifact.artifactId.toLowerCase(); const path = artifact.relativePath.toLowerCase();
    if (ids.has(id) || paths.some(prior => conflict(path, prior))) throw new OutputFailure('custody');
    ids.add(id); paths.push(path);
  }
}
async function resultFile(files: OutputFiles): Promise<{ readonly value: Readonly<EngineResult>; readonly bytes: number }> {
  const opened = await files.openOutput(OUTPUT_RESULT_FILE);
  try {
    const bytes = await files.readResult(opened); let input: unknown;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new OutputFailure('result'); }
    return { value: sealed(input), bytes: bytes.length };
  } finally { await files.closeOutput(opened); }
}
async function artifactFile(files: OutputFiles, artifact: EngineResult['artifacts'][number], io: OutputIO): Promise<void> {
  const opened = await files.openOutput(artifact.relativePath);
  try {
    if (opened.file.stat.size !== BigInt(artifact.bytes)) throw new OutputFailure('integrity');
    const hash = createHash('sha256'); const window = Buffer.allocUnsafe(OUTPUT_READ_BYTES); let position = 0;
    while (position < artifact.bytes) {
      const bytes = await files.read(opened, window, 0, position);
      hash.update(window.subarray(0, bytes)); position += bytes;
    }
    io.check();
    if (hash.digest('hex') !== artifact.sha256) throw new OutputFailure('integrity');
  } finally { await files.closeOutput(opened); }
}
export async function verifyOutputs(options: OutputSnapshot, files: OutputFiles, io: OutputIO): Promise<{
  readonly value: Readonly<EngineResult>; readonly verifiedBytes: number;
}> {
  const reported = sealed(options.reportedResult); scope(reported, options); inventory(reported); io.check();
  const result = await resultFile(files); scope(result.value, options); inventory(result.value);
  if (result.value.seal.sha256 !== reported.seal.sha256 || result.value.seal.sealedAt !== reported.seal.sealedAt) {
    throw new OutputFailure('result');
  }
  const verifiedBytes = accountedBytes(options, result.bytes, result.value.artifacts.map(artifact => artifact.bytes));
  for (const artifact of result.value.artifacts) await artifactFile(files, artifact, io);
  await files.finalCheck(); io.check(); return { value: result.value, verifiedBytes };
}
