import { candidateRoles, imageIdentity, revisionIdentity, architectureIdentity } from '../identity.js';
import type { CandidateRole } from '../identity.js';
import { object, imageMediaTypes } from './descriptors.js';
import type { ImageDescriptor, PlatformImage } from './descriptors.js';
import type { DeliveryBundle } from '../bundle.js';
export interface RegistryImage {
  role: CandidateRole;
  tag: string;
  index: ImageDescriptor;
  platforms: PlatformImage[];
}
export interface RegistryPlan {
  format: 'beetle-registry-plan';
  version: 1;
  revision: string;
  sourceRunId: number;
  repository: 'ghcr.io/beetlestance/beetle-lab';
  sources: { bytes: number; sha256: string; url: string };
  images: RegistryImage[];
}
function count(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw Error('Publication numeric bound');
  return value;
}
function captureDescriptor(value: unknown): ImageDescriptor {
  const row = object(value);
  if (typeof row.mediaType !== 'string') throw Error('Publication media type required');
  return { digest: imageIdentity(row.digest), size: count(row.size, 262144), mediaType: row.mediaType };
}
function platform(value: unknown): PlatformImage {
  const row = object(value);
  const captured = captureDescriptor(row);
  if (
    Object.keys(row).length !== 5 ||
    typeof row.architecture !== 'string' ||
    !imageMediaTypes.includes(captured.mediaType)
  )
    throw Error('Publication image descriptor invalid');
  return { ...captured, architecture: architectureIdentity(row.architecture), config: imageIdentity(row.config) };
}
function image(value: unknown, revision: string, runId: number): RegistryImage {
  const row = object(value);
  const role = candidateRoles.find((name) => name === row.role);
  if (
    !role ||
    Object.keys(row).length !== 4 ||
    row.tag !== `rewrite-${revision}-${runId}-${role}` ||
    !Array.isArray(row.platforms) ||
    row.platforms.length !== 2
  )
    throw Error('Publication role binding invalid');
  const platforms = row.platforms.map(platform);
  const index = captureDescriptor(row.index);
  if (
    Object.keys(object(row.index)).length !== 3 ||
    index.mediaType !== 'application/vnd.oci.image.index.v1+json' ||
    new Set(platforms.map((item) => item.architecture)).size !== 2
  )
    throw Error('Publication platform index invalid');
  return { role, tag: String(row.tag), index, platforms };
}
export function releaseTag(plan: RegistryPlan, sources = false): string {
  return `rewrite-${sources ? 'sources-' : ''}${plan.revision}-${plan.sourceRunId}`;
}
function planHeader(value: unknown) {
  const row = object(value);
  if (
    row.format !== 'beetle-registry-plan' ||
    row.version !== 1 ||
    Object.keys(row).length !== 7 ||
    typeof row.revision !== 'string' ||
    row.repository !== 'ghcr.io/beetlestance/beetle-lab'
  )
    throw Error('Publication plan invalid');
  const revision = revisionIdentity(row.revision);
  const sourceRunId = count(row.sourceRunId, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(row.images) || row.images.length !== 6) throw Error('Six publication roles required');
  return { row, revision, sourceRunId, imageRows: row.images };
}
export function captureRegistryPlan(value: unknown): RegistryPlan {
  const { row, revision, sourceRunId, imageRows } = planHeader(value);
  const images = imageRows.map((item) => image(item, revision, sourceRunId));
  if (new Set(images.map((item) => item.role)).size !== 6) throw Error('Duplicate publication role');
  const sources = object(row.sources);
  const url = `https://github.com/beetlestance/beetle-lab/releases/download/rewrite-sources-${revision}-${sourceRunId}/sources.tar.gz`;
  if (
    Object.keys(sources).length !== 3 ||
    sources.url !== url ||
    typeof sources.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(sources.sha256)
  )
    throw Error('Publication source binding invalid');
  return {
    format: 'beetle-registry-plan',
    version: 1,
    revision,
    sourceRunId,
    repository: 'ghcr.io/beetlestance/beetle-lab',
    images,
    sources: { bytes: count(sources.bytes, 640 * 1024 ** 2), sha256: sources.sha256, url },
  };
}
export function composeEnvironment(plan: RegistryPlan): string {
  const variables: Record<CandidateRole, string> = {
    frontend: 'FRONTEND',
    backend: 'BACKEND',
    agent: 'AGENT',
    installer: 'INSTALLER',
    engine: 'ENGINE',
    export: 'EXPORT',
  };
  return (
    candidateRoles
      .map((role) => {
        const image = plan.images.find((item) => item.role === role)!;
        return `BEETLE_${variables[role]}_IMAGE=${plan.repository}@${image.index.digest}`;
      })
      .join('\n') + '\n'
  );
}
export function planCandidates(plan: RegistryPlan): Pick<DeliveryBundle, 'architecture' | 'configs'>[] {
  return (['amd64', 'arm64'] as const).map((architecture) => ({
    architecture,
    configs: Object.fromEntries(
      plan.images.map((image) => [
        image.role,
        image.platforms.find((row) => row.architecture === architecture)!.config,
      ]),
    ) as DeliveryBundle['configs'],
  }));
}
export function capturePublishedPlan(value: unknown): RegistryPlan {
  const record = object(value);
  if (record.format !== 'beetle-published-candidate' || record.version !== 1 || record.status !== 'published')
    throw Error('Published candidate required');
  return captureRegistryPlan(record.plan);
}
