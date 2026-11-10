import type { BigIntStats } from 'node:fs';
import type { OutputFileReceipt, OutputFileRecord } from '../../../../ports/output-bytes.js';
import { PhysicalFile } from '../custody/index.js';
import type { PhysicalPublication, Roots } from '../custody/index.js';
import type { FileJob } from './job.js';
import { identity } from './identity.js';
import { fail } from './errors.js';

export async function locations(job: FileJob<unknown>, roots: Roots, record: OutputFileRecord, create: boolean): Promise<PhysicalPublication> {
  const key = record.binding.key; const attempt = key.attempt;
  const name = { components: [attempt.organizationId, attempt.workspaceId, key.runId, attempt.attemptId], name: record.artifact.token };
  return { tree: job.tree, content: record.artifact,
    stage: await job.tree.location(roots.stage, name, create), destination: await job.tree.location(roots.published, name, create) };
}
export function mutation(record: OutputFileRecord, phase: 'transferring' | 'publishing'): void {
  if (record.artifact.phase !== phase || record.artifact.writer === null) fail('invalid_input');
}
export async function match(file: PhysicalFile, roots: Roots, record: OutputFileRecord, published: boolean): Promise<void> {
  await file.verify(); const stat = await file.handle.stat({ bigint: true });
  if (identity(record, roots, stat, published) !== record.artifact.identity) fail('integrity');
  await file.verify();
}
function extent(stat: BigIntStats, record: OutputFileRecord): number {
  if (stat.size < BigInt(record.artifact.offset) || stat.size > BigInt(record.artifact.bytes)) fail('integrity');
  return Number(stat.size);
}
export async function receipt(job: FileJob<unknown>, roots: Roots, record: OutputFileRecord,
  file: PhysicalFile, published: boolean): Promise<OutputFileReceipt> {
  file.requireLinks(1n); const stat = await job.confirm(file);
  return { token: record.artifact.token, offset: extent(stat, record), phase: published ? 'published' : 'transferring',
    identity: identity(record, roots, stat, published) };
}
export async function stage(job: FileJob<unknown>, roots: Roots, record: OutputFileRecord): Promise<PhysicalFile> {
  const places = await locations(job, roots, record, true);
  if (await PhysicalFile.open(job.tree, places.destination, false)) fail('integrity');
  let file = await PhysicalFile.open(job.tree, places.stage, true);
  if (!file) {
    if (record.artifact.identity !== null || record.artifact.offset !== 0) fail('custody_missing');
    file = await PhysicalFile.create(job.tree, places.stage);
  }
  file.requireLinks(1n);
  if (record.artifact.identity === null) {
    if (record.artifact.offset !== 0 || file.size !== 0n) fail('integrity');
  } else await match(file, roots, record, false);
  if (file.size < BigInt(record.artifact.offset) || file.size > BigInt(record.artifact.bytes)) fail('integrity');
  await file.sync(); await job.tree.sync(places.stage.parent); return file;
}
export async function published(job: FileJob<unknown>, roots: Roots, record: OutputFileRecord): Promise<PhysicalFile> {
  if (record.artifact.phase !== 'published' || record.artifact.writer !== null || record.artifact.identity === null) fail('invalid_input');
  const places = await locations(job, roots, record, false);
  await PhysicalFile.requireAbsent(job.tree, places.stage.absentAncestor ?? places.stage.path);
  const file = await PhysicalFile.open(job.tree, places.destination, false); if (!file) fail('custody_missing');
  file.requireLinks(1n); await match(file, roots, record, true); return file;
}
