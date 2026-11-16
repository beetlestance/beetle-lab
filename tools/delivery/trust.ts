import {revisionIdentity, maximumArtifactZipBytes} from './identity.js';

const repository = 'beetlestance/beetle-lab';
const branch = 'rewrite/integration';
const gates = ['ci/source', 'ci/checks', 'ci/container',
  'ci/rewrite-container (amd64)', 'ci/rewrite-container (arm64)',
  ...Array.from({length: 6}, (_, index) => `ci/tests (${index + 1}/6)`)];
const kinds = ['images', 'native', 'supply-chain', 'roundtrip'] as const;
export interface QualifiedArtifact {
  readonly id: number; readonly name: string; readonly bytes: number; readonly artifactDigest: string;
}
export interface QualifiedRun {
  readonly runId: number; readonly repositoryId: number; readonly workflowId: number;
  readonly revision: string; readonly artifacts: readonly QualifiedArtifact[];
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Delivery metadata object required');
  return value as Record<string, unknown>;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('Delivery metadata integer required');
  return value;
}
function entries(value: unknown, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > maximum) throw Error('Delivery metadata list bound');
  return value.map(record);
}
function repo(value: unknown): number {
  const row = record(value);
  if (row.full_name !== repository) throw Error('Untrusted delivery repository');
  return positive(row.id);
}
function succeeded(row: Record<string, unknown>): boolean {
  return row.status === 'completed' && row.conclusion === 'success';
}
export function captureRun(input: unknown, expected: {runId: number; revision: string; workflowId: number}) {
  const run = record(input); const repositoryId = repo(run.repository);
  positive(expected.runId); positive(expected.workflowId); revisionIdentity(expected.revision);
  if (run.id !== expected.runId || run.workflow_id !== expected.workflowId || repo(run.head_repository) !== repositoryId
    || run.path !== '.github/workflows/ci.yml' || run.event !== 'workflow_dispatch'
    || run.head_branch !== branch || run.head_sha !== expected.revision || run.run_attempt !== 1
    || !succeeded(run)) throw Error('Unqualified delivery workflow run');
  return {runId: expected.runId, revision: expected.revision, workflowId: expected.workflowId, repositoryId};
}
export function captureJobs(input: unknown, run: ReturnType<typeof captureRun>, required: readonly string[] = gates): void {
  const page = record(input); const jobs = entries(page.jobs, 100);
  if (page.total_count !== jobs.length) throw Error('Incomplete delivery jobs');
  for (const name of required) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1) throw Error('Missing or duplicate delivery gate');
    const job = matches[0]!;
    if (job.run_id !== run.runId || job.run_attempt !== 1 || job.head_sha !== run.revision
      || job.status !== 'completed' || job.conclusion !== 'success') throw Error('Unsuccessful delivery gate');
  }
}
function artifactOwner(value: unknown, run: ReturnType<typeof captureRun>): void {
  const owner = record(value);
  if (owner.id !== run.runId || owner.repository_id !== run.repositoryId || owner.head_repository_id !== run.repositoryId
    || owner.head_branch !== branch || owner.head_sha !== run.revision) throw Error('Unqualified delivery artifact owner');
}
export function captureArtifact(row: Record<string, unknown>, run: ReturnType<typeof captureRun>, name: string, maximum: number): QualifiedArtifact {
  artifactOwner(row.workflow_run, run); const bytes = positive(row.size_in_bytes);
  if (row.name !== name || row.expired !== false || bytes > maximum) throw Error('Unqualified delivery artifact');
  if (typeof row.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(row.digest)) throw Error('Artifact digest required');
  return Object.freeze({id: positive(row.id), name, bytes, artifactDigest: row.digest});
}
function captureArtifacts(input: unknown, run: ReturnType<typeof captureRun>): readonly QualifiedArtifact[] {
  const page = record(input); const artifacts = entries(page.artifacts, 100);
  if (page.total_count !== artifacts.length) throw Error('Incomplete delivery artifacts');
  const selected: QualifiedArtifact[] = [];
  for (const architecture of ['amd64', 'arm64']) for (const kind of kinds) {
    const name = `rewrite-${kind}-${architecture}-${run.revision}`;
    const matches = artifacts.filter(row => row.name === name);
    if (matches.length !== 1) throw Error('Missing or duplicate delivery artifact');
    const maximum = kind === 'images' ? maximumArtifactZipBytes
      : kind === 'supply-chain' ? 50 * 1024 ** 2 : 65536;
    selected.push(captureArtifact(matches[0]!, run, name, maximum));
  }
  if (new Set(selected.map(row => row.id)).size !== selected.length) throw Error('Duplicate delivery artifact ID');
  return Object.freeze(selected);
}
/** Authenticated API snapshots only. This selects immutable artifacts, never grants registry authority.
 * Their ZIP digest, archive/config hashes, execution/scans and roundtrip still need verification. */
export function captureQualifiedRun(input: {run: unknown; jobs: unknown; artifacts: unknown},
  expected: {runId: number; revision: string; workflowId: number}): QualifiedRun {
  const run = captureRun(input.run, expected); captureJobs(input.jobs, run);
  return Object.freeze({...run, artifacts: captureArtifacts(input.artifacts, run)});
}
