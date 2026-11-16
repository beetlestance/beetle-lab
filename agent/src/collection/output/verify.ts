import { createHash } from 'node:crypto';
import { encodeJson, verifyEngineResultSeal, captureExportResultForExpectation, executionArtifacts, executionEngineId } from '@beetle/contracts';
import type { Artifact, ExecutionResult } from '@beetle/contracts';
import { CONTROL_FILE } from '../../control-protocol/index.js';
import { OUTPUT_READ_BYTES, OUTPUT_RESULT_FILE, OUTPUT_CUSTODY_BYTES } from './types.js';
import { accountedBytes } from './budget.js';
import type { OutputSnapshot } from './budget.js';
import { OutputFailure } from './ports.js';
import type { OutputIO } from './ports.js';
import type { OutputFiles } from './files.js';
import type { OutputCustody } from './types.js';

function sealed(input: unknown, options: OutputSnapshot): Readonly<ExecutionResult> {
  if (options.expectedExport) {
    try {return captureExportResultForExpectation(input,options.expectedExport,text=>createHash('sha256').update(text).digest('hex'));}
    catch {throw new OutputFailure('result');}
  }
  const result = verifyEngineResultSeal(input, text => createHash('sha256').update(text).digest('hex'));
  if (!result.ok) throw new OutputFailure('result');
  return result.value;
}
function scope(result: Readonly<ExecutionResult>, options: OutputSnapshot): void {
  for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) {
    if (result[key] !== options.key[key]) throw new OutputFailure('result');
  }
  if (executionEngineId(result) !== options.engineId) throw new OutputFailure('result');
}
function conflict(a: string, b: string): boolean { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
function inventory(result: Readonly<ExecutionResult>): void {
  const ids = new Set<string>(); const paths = [OUTPUT_RESULT_FILE, 'export-result.json', CONTROL_FILE];
  for (const artifact of executionArtifacts(result)) {
    const id = artifact.artifactId.toLowerCase(); const path = artifact.relativePath.toLowerCase();
    if (ids.has(id) || paths.some(prior => conflict(path, prior))) throw new OutputFailure('custody');
    ids.add(id); paths.push(path);
  }
}
async function resultFile(files: OutputFiles,options: OutputSnapshot): Promise<{ readonly value: Readonly<ExecutionResult>; readonly bytes: number }> {
  const opened = await files.openOutput(options.expectedExport ? 'export-result.json' : OUTPUT_RESULT_FILE);
  try {
    const bytes = await files.readResult(opened); let input: unknown;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new OutputFailure('result'); }
    return { value: sealed(input,options), bytes: bytes.length };
  } finally { await files.closeOutput(opened); }
}
async function artifactFile(files: OutputFiles, artifact: Readonly<Artifact>, io: OutputIO): Promise<void> {
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
  readonly value: Readonly<ExecutionResult>; readonly verifiedBytes: number; readonly custody: Readonly<OutputCustody>;
}> {
  const reported = sealed(options.reportedResult,options); scope(reported, options); inventory(reported); io.check();
  const result = await resultFile(files,options); scope(result.value, options); inventory(result.value);
  if (result.value.seal.sha256 !== reported.seal.sha256 || result.value.seal.sealedAt !== reported.seal.sealedAt) {
    throw new OutputFailure('result');
  }
  const verifiedBytes = accountedBytes(options, result.bytes, executionArtifacts(result.value).map(artifact => artifact.bytes));
  for (const artifact of executionArtifacts(result.value)) await artifactFile(files, artifact, io);
  await files.finalCheck(); io.check();
  const custody = Object.freeze({ resultFileBytes: result.bytes, controlBytes: options.controlBytes, root: files.rootIdentity() });
  encodeJson(custody, OUTPUT_CUSTODY_BYTES);
  return { value: result.value, verifiedBytes, custody };
}
