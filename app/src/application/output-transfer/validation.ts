import type { ResultDigest } from '@beetle/contracts';
import { captureExportResultForExpectation } from '@beetle/contracts';
import { executionArtifacts } from '@beetle/contracts';
import { encodeCanonicalJson, validate, validatePrimitive } from '@beetle/contracts';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import { SOURCE_ENVELOPE_BYTES } from '@beetle/contracts/output-source';
import { captureOutputBinding, isExportOutput } from '../../domain/output-owner/index.js';
import { immutableSnapshot } from '../../domain/namespaces/index.js';
import type { OutputBinding } from '../../domain/output-owner/index.js';
import type { OutputArtifactState, OutputCustodyState } from '../../ports/output-custody.js';
import type { OutputFileReceipt, OutputFileRecord } from '../../ports/output-bytes.js';
import { fail, requireTransfer as check } from './errors.js';

export function snapshot<T>(value: T, maximum: number): T {
  try { return immutableSnapshot(JSON.parse(encodeCanonicalJson(value, maximum)) as T); }
  catch { fail('integrity'); }
}
export function same(a: unknown, b: unknown): boolean {
  return encodeCanonicalJson(a, 4096) === encodeCanonicalJson(b, 4096);
}
export function binding(input: OutputBinding): OutputBinding {
  try { return captureOutputBinding(input); } catch { fail('invalid_input'); }
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) && validatePrimitive('uuid', value).ok;
}
const hash = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const natural = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
export function envelope(input: Owned<SourceEnvelope>, original: OutputBinding, digest?: ResultDigest): Owned<SourceEnvelope> {
  const value = snapshot(input, SOURCE_ENVELOPE_BYTES);
  check(validate('SourceEnvelope', value).ok);
  if (isExportOutput(original)) {
    check(typeof digest === 'function');
    try { captureExportResultForExpectation(value.manifest.result, original.expectation, digest); } catch { fail('integrity'); }
  } else check(!('purpose' in value.manifest.result));
  const remote = value.manifest.binding;
  check(same(original.key.attempt, {organizationId: remote.organizationId, workspaceId: remote.workspaceId,
    attemptId: remote.attemptId, generation: remote.generation, intentDigest: remote.intentDigest}));
  check(remote.journalAuthority === original.journalAuthority);
  const receipt = value.closure.receipt;
  check(receipt.journalAuthority === remote.journalAuthority && receipt.manifestDigest === value.manifest.manifestDigest
    && receipt.sourceDigest === value.sourceDigest);
  check(same(receipt.key, {organizationId: remote.organizationId, workspaceId: remote.workspaceId,
    attemptId: remote.attemptId, generation: remote.generation}));
  check(executionArtifacts(value.manifest.result).length <= 128); return value;
}
export function artifact(value: OutputArtifactState): void {
  check(natural(value.ordinal) && value.ordinal < 128 && uuid(value.artifactId) && uuid(value.token));
  check(natural(value.bytes) && natural(value.offset) && value.offset <= value.bytes && hash(value.sha256));
  check(natural(value.version) && value.version > 0);
  check(value.identity === null || hash(value.identity)); check(value.writer === null || uuid(value.writer));
  artifactPhase(value);
}
function artifactPhase(value: OutputArtifactState): void {
  check(['transferring', 'publishing', 'published'].includes(value.phase));
  check(value.identity !== null || value.offset === 0);
  if (value.phase !== 'transferring') check(value.offset === value.bytes && value.identity !== null);
  if (value.phase === 'publishing') check(value.writer !== null);
  if (value.phase === 'published') check(value.writer === null);
}
export function state(input: OutputCustodyState<OutputBinding>, original: OutputBinding): OutputCustodyState<OutputBinding> {
  const value = snapshot(input, 65_536); check(same(value.binding, original));
  check(value.kind === 'pending' || value.kind === 'adopted');
  if (value.kind === 'adopted') {
    check(hash(value.manifestDigest) && hash(value.sourceDigest) && value.version === 1);
    check(natural(value.finalAgentSeq) && value.artifacts.length <= 128);
    value.artifacts.forEach((item, ordinal) => { artifact(item); check(item.ordinal === ordinal); });
    check(new Set(value.artifacts.map(item => item.token)).size === value.artifacts.length);
  }
  return value;
}
export function matchedState(value: Extract<OutputCustodyState<OutputBinding>, {kind: 'adopted'}>, source: Owned<SourceEnvelope>): void {
  check(value.manifestDigest === source.manifest.manifestDigest && value.sourceDigest === source.sourceDigest);
  check(value.finalAgentSeq === source.closure.finalAgentSeq);
  const declared = executionArtifacts(source.manifest.result); check(value.artifacts.length === declared.length);
  value.artifacts.forEach((item, ordinal) => {
    const expected = declared[ordinal]!;
    check(item.artifactId === expected.artifactId && item.bytes === expected.bytes && item.sha256 === expected.sha256);
  });
}
export function record(input: OutputFileRecord<OutputBinding>, previous: OutputFileRecord<OutputBinding>): OutputFileRecord<OutputBinding> {
  const value = snapshot(input, 4096); check(same(value.binding, previous.binding)); artifact(value.artifact);
  for (const key of ['ordinal', 'artifactId', 'token', 'bytes', 'sha256'] as const) check(value.artifact[key] === previous.artifact[key]);
  check(value.artifact.version >= previous.artifact.version && value.artifact.offset >= previous.artifact.offset);
  return value;
}
export function receipt(input: OutputFileReceipt, value: OutputFileRecord<OutputBinding>, published: boolean): OutputFileReceipt {
  const result = snapshot(input, 4096); check(result.token === value.artifact.token && hash(result.identity));
  check(natural(result.offset) && result.offset >= value.artifact.offset && result.offset <= value.artifact.bytes);
  check(result.phase === (published ? 'published' : 'transferring'));
  if (published) check(result.offset === value.artifact.bytes);
  else check(value.artifact.identity === null || value.artifact.identity === result.identity);
  return result;
}
