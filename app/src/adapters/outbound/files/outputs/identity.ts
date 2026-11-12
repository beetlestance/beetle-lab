import { isExportOutput } from '../../../../domain/output-owner/index.js';
import type { OutputBinding } from '../../../../domain/output-owner/index.js';
import type { OutputDeletionIntent } from '../../../../ports/output-deletion.js';
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import type { Roots } from '../custody/index.js';

function stable(stat: BigIntStats) {
  return { device: stat.dev.toString(), inode: stat.ino.toString(), uid: stat.uid.toString(), gid: stat.gid.toString(), mode: stat.mode.toString() };
}
export function identity(record: OutputFileRecord<OutputBinding>, roots: Roots, stat: BigIntStats, published: boolean): string {
  const artifact = record.artifact;
  const value = { binding: record.binding,
    artifact: { ordinal: artifact.ordinal, artifactId: artifact.artifactId, token: artifact.token, bytes: artifact.bytes, sha256: artifact.sha256 },
    roots: [roots.stage, roots.published].map(root => ({ path: root.path, ...stable(root.stat) })), file: stable(stat),
    final: published ? { bytes: stat.size.toString(), modifiedNs: stat.mtimeNs.toString(), changedNs: stat.ctimeNs.toString(), links: stat.nlink.toString() } : null };
  const owner = isExportOutput(record.binding) ? 'beetle.export.output' : 'beetle.output';
  const domain = owner + (published ? '.published.v1\0' : '.staging.v1\0');
  return createHash('sha256').update(domain).update(encodeCanonicalJson(value, 8192)).digest('hex');
}

/** Stable across legitimate child creation/reopen; not a host free-space claim. */
export function deletionNamespace(roots: Roots): string {
  const value = [roots.stage, roots.published].map(root => ({path: root.path, ...stable(root.stat)}));
  return createHash('sha256').update('beetle.output.deletion.namespace.v1\0').update(encodeCanonicalJson(value, 8192)).digest('hex');
}
export function deletionPreparation(intent: OutputDeletionIntent, namespaceIdentity: string): string {
  const value = {record: intent.record, deletionId: intent.deletionId, deletionVersion: intent.deletionVersion, namespaceIdentity};
  return createHash('sha256').update('beetle.output.deletion.preparation.v1\0').update(encodeCanonicalJson(value, 8192)).digest('hex');
}
