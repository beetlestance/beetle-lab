import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {candidateRoles, imageIdentity} from './identity.js';
import type {ImageReferences} from './references.js';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Archive metadata object required');
  return value as Record<string, unknown>;
}
export type ArchiveMember = (name: string) => Buffer;
export function archiveMember(path: string): ArchiveMember {
  return name => {
    if (!/^(?:manifest\.json|index\.json|blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\.json)$/.test(name)) throw Error('Invalid archive metadata member');
    return execFileSync('tar', ['-xOf', path, name], {timeout: 15000, maxBuffer: 262144, stdio: ['ignore', 'pipe', 'pipe']});
  };
}
const digest = (bytes: Buffer) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function configPath(path: unknown): string {
  if (typeof path !== 'string' || !/^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\.json)$/.test(path)) throw Error('Invalid archive config');
  return path;
}
function captureManifest(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length !== 6) throw Error('Archive must contain six images');
  return value.map(object);
}
/** Docker IDs, config digests and registry manifests are deliberately separate. */
export function archiveConfigs(read: ArchiveMember, references: ImageReferences, identity: {revision: string; architecture: string; images: ImageReferences}): ImageReferences {
  const manifests = manifestIdentities(read);
  const entries = captureManifest(JSON.parse(read('manifest.json').toString('utf8')));
  return Object.freeze(Object.fromEntries(candidateRoles.map(role => {
    const matching = entries.filter(entry => Array.isArray(entry.RepoTags) && entry.RepoTags.includes(references[role]));
    if (matching.length !== 1) throw Error('Missing or duplicate archive role');
    const path = configPath(matching[0]!.Config); const bytes = read(path); const id = imageIdentity(digest(bytes));
    if (!path.includes(id.slice(7))) throw Error('Archive config hash mismatch');
    const config = object(JSON.parse(bytes.toString('utf8'))); const labels = object(object(config.config).Labels);
    if (config.os !== 'linux' || config.architecture !== identity.architecture || labels['org.opencontainers.image.revision'] !== identity.revision) throw Error('Archive config identity mismatch');
    const manifest = manifests.get(id);
    if (!manifest || ![id, manifest].includes(identity.images[role])) throw Error('Archive source content identity mismatch');
    return [role, id];
  })) as Record<keyof ImageReferences, string>);
}

function manifestIdentities(read: ArchiveMember): ReadonlyMap<string, string> {
  const index = object(JSON.parse(read('index.json').toString('utf8')));
  const rows = captureManifest(index.manifests); const manifests = new Map<string, string>();
  for (const row of rows) {
    const id = imageIdentity(row.digest); const bytes = read('blobs/sha256/' + id.slice(7));
    if (digest(bytes) !== id) throw Error('Archive manifest hash mismatch');
    const manifest = object(JSON.parse(bytes.toString('utf8'))); const config = imageIdentity(object(manifest.config).digest);
    if (manifests.has(config)) throw Error('Duplicate archive config');
    manifests.set(config, id);
  }
  return manifests;
}

/** Both daemon storage forms must bind to the same verified archive bytes. */
export function archiveLocalIds(read: ArchiveMember, references: ImageReferences, identity: {revision: string; architecture: string; images: ImageReferences}) {
  const configs = archiveConfigs(read, references, identity); const manifests = manifestIdentities(read);
  return Object.fromEntries(candidateRoles.map(role => [role, {config: configs[role], manifest: manifests.get(configs[role])!}])) as
    Record<keyof ImageReferences, {config: string; manifest: string}>;
}
