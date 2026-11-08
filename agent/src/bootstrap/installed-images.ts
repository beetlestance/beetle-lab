import { encodeJson } from '@beetle/contracts';
import type { Catalog } from '../catalog/index.js';
import type { DockerReply, DockerTransport, Operation } from '../backends/docker/index.js';
import type { InstalledEngine } from '../catalog/index.js';
import { performance } from 'node:perf_hooks';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid installed image');
  return value as Record<string, unknown>;
}
function body(reply: DockerReply): Record<string, unknown> {
  if (!reply.ok || reply.status !== 200) throw new Error('Installed image unavailable');
  return record(JSON.parse(encodeJson(reply.body, 1_048_576)) as unknown);
}
function architecture(value: unknown): 'arm64' | 'amd64' {
  if (value === 'aarch64' || value === 'arm64') return 'arm64';
  if (value === 'x86_64' || value === 'amd64') return 'amd64';
  throw new Error('Unsupported installed architecture');
}
function matches(image: Record<string, unknown>, engine: Readonly<InstalledEngine>, info: Record<string, unknown>): boolean {
  const config = record(image.Config);
  const environment = config.Env ?? [];
  const volumes = config.Volumes;
  if (volumes !== undefined && volumes !== null && Object.keys(record(volumes)).length !== 0) return false;
  return image.Id === engine.profile.imageDigest && image.Os === 'linux'
    && architecture(image.Architecture) === architecture(info.Architecture)
    && info.DefaultRuntime === engine.profile.effectiveImage.defaultRuntime
    && encodeJson(environment, 16_384) === encodeJson(engine.profile.effectiveImage.environment, 16_384);
}
/** Read-only installed image pins. Never pulls, tags, mutates or starts an image. */
export async function verifyInstalledImages(input: {
  catalog: Catalog; transport: DockerTransport; expectedDaemonId: string; operation: Operation;
}): Promise<boolean> {
  try {
    const { operation, transport } = input;
    const request = async (path: string) => {
      if (operation.signal?.aborted || performance.now() >= operation.deadline) throw new Error('Installation inspection expired');
      const reply = await transport.request({ ...operation, method: 'GET', path });
      if (operation.signal?.aborted || performance.now() >= operation.deadline) throw new Error('Installation inspection expired');
      return body(reply);
    };
    const info = await request('/v1.47/info');
    if (operation.signal?.aborted || info.ID !== input.expectedDaemonId || info.OSType !== 'linux') return false;
    for (const engine of input.catalog.engines) {
      const image = await request(`/v1.47/images/${engine.profile.imageDigest}/json`);
      if (operation.signal?.aborted || !matches(image, engine, info)) return false;
    }
    return true;
  } catch { return false; }
}
