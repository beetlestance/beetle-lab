import { candidateRoles } from '../identity.js';
import { hash } from './descriptors.js';
import type { RegistryPlan, RegistryImage } from './value.js';
export function publicationFixture() {
  const revision = 'a'.repeat(40);
  const sourceRunId = 17;
  const url = `https://github.com/beetlestance/beetle-lab/releases/download/rewrite-sources-${revision}-${sourceRunId}/sources.tar.gz`;
  const bodies = new Map<string, Buffer>();
  const images: RegistryImage[] = candidateRoles.map((role, ordinal) => {
    const platforms = (['amd64', 'arm64'] as const).map((architecture, index) => ({
      architecture,
      digest: 'sha256:' + String(ordinal * 2 + index + 1).padStart(64, '0'),
      config: 'sha256:' + String(ordinal * 2 + index + 30).padStart(64, '0'),
      size: 100,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
    }));
    const raw = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.index.v1+json',
        annotations: {
          'org.opencontainers.image.revision': revision,
          'dev.beetlestance.sources': url,
          'org.opencontainers.image.documentation': `https://github.com/beetlestance/beetle-lab/releases/tag/rewrite-${revision}-${sourceRunId}`,
        },
        manifests: platforms.map((image) => ({
          digest: image.digest,
          size: image.size,
          mediaType: image.mediaType,
          platform: { os: 'linux', architecture: image.architecture },
        })),
      }),
    );
    const digest = hash(raw);
    bodies.set(digest, raw);
    return {
      role,
      tag: `rewrite-${revision}-${sourceRunId}-${role}`,
      platforms,
      index: { digest, size: raw.length, mediaType: 'application/vnd.oci.image.index.v1+json' },
    };
  });
  const plan: RegistryPlan = {
    format: 'beetle-registry-plan',
    version: 1,
    revision,
    sourceRunId,
    repository: 'ghcr.io/beetlestance/beetle-lab',
    sources: { bytes: 1, sha256: 'b'.repeat(64), url },
    images,
  };
  return { plan, bodies };
}
