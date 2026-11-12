import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { encodeJson, validate, EXPORT_ASSIGNMENT_BYTES } from '@beetle/contracts';
import type { StagedAttempt } from '@beetle/contracts';
import { serializeStagedOffer, stagingPolicy } from '../admission/index.js';
import { prepareRuntime, runtimeName } from '../backends/docker/index.js';
import type { RuntimePlan, StagedRoots } from '../backends/docker/index.js';
import { freeze } from './bounds.js';
import type { Boundary } from './bounds.js';
import { authorize, eligibility } from './authority.js';
import type { Authorized } from './authority.js';
import { bytes, Files } from './files.js';
import { rootIdentity, boundRootNamespace } from './root.js';
import { StagingError } from './types.js';
import type { StagerOptions, PrepareRequest } from './types.js';

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
export interface Work { readonly plan: RuntimePlan; readonly files: Files }
export function createFiles(options: StagerOptions, boundary: Boundary, check: () => Promise<void>): Files {
  return new Files(rootIdentity(options.root), boundary, check);
}
export async function prepareFiles(input: { options: StagerOptions; request: PrepareRequest; boundary: Boundary;
  ownFiles(files: Files): void }): Promise<RuntimePlan> {
  const { options, request, boundary } = input;
  const authorized = await authorize(options, request.key, boundary);
  boundary.bindWall(authorized.deadlineMs, options.wallNow ?? Date.now);
  await eligibility(options, authorized, boundary);
  const name = runtimeName({ ...request.key, installationId: options.profile.installationId });
  const taskRoot = join(options.profile.stagingRoot, name);
  const staged = freeze({ input: join(taskRoot, 'input'), output: join(taskRoot, 'output'), secrets: join(taskRoot, 'secrets') });
  const prepared = prepareRuntime({ offer: authorized.offer, manifest: options.manifest,
    profile: options.profile, generation: request.key.generation, staged,
    ...(authorized.assignment ? {assignment:{purpose:'standalone_export',assignmentDigest:authorized.assignment.assignmentDigest}} : {}) });
  if (!prepared.ok || prepared.value.name !== name) throw new StagingError('invalid_input');
  const plan = prepared.value;
  checkPlan(plan, authorized, options);
  const check = () => eligibility(options, authorized, boundary);
  const files = createFiles(options, boundary, check); input.ownFiles(files);
  const namespaceIntent = { protocolVersion: 1 as const, original: { ...request.key, generation: 1 as const, intentDigest: authorized.offer.intentDigest },
    purpose: authorized.assignment ? 'standalone_export' as const : 'performance' as const,
    namespaceIdentity: boundRootNamespace(options.root).namespaceIdentity, specDigest: plan.specDigest, runtimeName: name };
  const namespace = await boundary.wait(() => options.journal.stagingNamespace.beginTask(namespaceIntent));
  if (namespace.state !== 'preparing') throw new StagingError('reservation');
  await files.directory(taskRoot);
  for (const path of [staged.input, staged.output, staged.secrets]) await files.directory(path);
  await files.syncDirectories();
  const directories = await files.directoryFacts({ task: taskRoot, input: staged.input, output: staged.output, secrets: staged.secrets });
  await boundary.wait(() => options.journal.stagingNamespace.commitTask({ intent: namespaceIntent, directories }));
  await check();
  await stageInputs({ options, authorized, files, staged, boundary });
  await stageSecrets({ options, authorized, files, staged, boundary });
  const offerBytes = utf8(serializeStagedOffer(authorized.offer));
  const manifestBytes = utf8(encodeJson(options.manifest, stagingPolicy.manifestBytes));
  await files.file(staged.input, 'offer.json', bytes(offerBytes), authorized.reservation.staging.offerBytes);
  if (authorized.assignment) await files.file(staged.input,'assignment.json',bytes(utf8(encodeJson(authorized.assignment,EXPORT_ASSIGNMENT_BYTES))),authorized.reservation.staging.assignmentBytes!);
  await files.file(staged.input, 'manifest.json', bytes(manifestBytes), stagingPolicy.manifestBytes);
  await files.syncDirectories(); await check();
  const metadata = stagedMetadata({ authorized, plan, offerBytes, manifestBytes });
  await files.file(staged.input, 'staging.json', bytes(utf8(encodeJson(metadata, stagingPolicy.metadataBytes))), stagingPolicy.metadataBytes);
  await files.syncDirectories(); await check(); boundary.check();
  return plan;
}
function checkPlan(plan: RuntimePlan, authorized: Authorized, options: StagerOptions): void {
  const labels = plan.spec.Labels;
  if (plan.spec.Image !== authorized.offer.engine.imageDigest || plan.spec.User !== options.profile.user
    || labels['dev.beetle.intent'] !== authorized.offer.intentDigest
    || labels['dev.beetle.generation'] !== String(authorized.authority.generation)
    || labels['dev.beetle.spec'] !== plan.specDigest) throw new StagingError('invalid_input');
}
interface StageInput { options: StagerOptions; authorized: Authorized; files: Files; staged: StagedRoots; boundary: Boundary }
async function stageInputs(input: StageInput): Promise<void> {
  const { options, authorized, files, staged, boundary } = input;
  for (const [index, reference] of authorized.offer.inputs.entries()) {
    await eligibility(options, authorized, boundary);
    const request = Object.freeze({ authority: authorized.authority, input: reference, signal: boundary.signal });
    const source = await boundary.wait(() => options.providers.input(request));
    const hash = createHash('sha256');
    const size = await files.file(staged.input, `input-${String(index).padStart(3, '0')}.bin`, source, reference.bytes, chunk => hash.update(chunk));
    if (size !== reference.bytes || hash.digest('hex') !== reference.sha256) throw new StagingError('input_integrity');
  }
}
async function stageSecrets(input: StageInput): Promise<void> {
  const { options, authorized, files, staged, boundary } = input;
  let total = 0;
  for (const reference of authorized.offer.secretReferences ?? []) {
    await eligibility(options, authorized, boundary);
    const request = Object.freeze({ authority: authorized.authority, secret: reference, signal: boundary.signal });
    const raw = await boundary.wait(() => options.providers.secret(request));
    if (!(raw instanceof Uint8Array) || raw.byteLength > stagingPolicy.secretBytes
      || total + raw.byteLength > authorized.reservation.staging.secretBytes) throw new StagingError('secret_limit');
    const value = new Uint8Array(raw); total += value.byteLength;
    try { await files.file(staged.secrets!, reference.name, bytes(value), value.byteLength); }
    finally { value.fill(0); }
  }
}
function stagedMetadata(input: { authorized: Authorized; plan: RuntimePlan; offerBytes: Uint8Array; manifestBytes: Uint8Array }): StagedAttempt {
  const { authorized, plan } = input;
  const offer = authorized.offer;
  const metadata = { protocolVersion: '1.0' as const, organizationId: offer.organizationId, workspaceId: offer.workspaceId,
    attemptId: offer.attemptId, generation: authorized.authority.generation, intentDigest: offer.intentDigest,
    specDigest: plan.specDigest, offerSha256: digest(input.offerBytes), manifestSha256: digest(input.manifestBytes),
    ...(authorized.assignment ? {assignment:{purpose:'standalone_export' as const,assignmentDigest:authorized.assignment.assignmentDigest,fileName:'assignment.json' as const}} : {}),
    deadlineMs: authorized.deadlineMs, stagingPolicyVersion: 1 as const,
    inputFiles: offer.inputs.map((reference, index) => ({ inputId: reference.id, fileName: `input-${String(index).padStart(3, '0')}.bin` })),
    secretNames: (offer.secretReferences ?? []).map(secret => secret.name) };
  const checked = validate('StagedAttempt', metadata);
  if (!checked.ok) throw new StagingError('invalid_input');
  return checked.value;
}
