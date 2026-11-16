import {hash, captureRoleIndex, object} from './descriptors.js';
import {releaseTag} from './value.js';
import type {RegistryPlan, RegistryImage} from './value.js';
export interface RegistryCommands {raw(args: readonly string[]): Promise<Buffer>; command(args: readonly string[]): Promise<void>}
async function tags(tool: RegistryCommands, repository: string): Promise<readonly string[]> {
  const raw = await tool.raw(['tag', 'ls', repository, '--format', '{{json .Tags}}']);
  const value: unknown = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(value) || value.length > 4096 || !value.every(tag => typeof tag === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(tag))) throw Error('Incomplete registry tag inventory');
  return value as string[];
}
async function verify(tool: RegistryCommands, reference: string, image: RegistryImage, plan: RegistryPlan): Promise<void> {
  const raw = await tool.raw(['manifest', 'get', reference, '--format', 'raw-body']);
  if (raw.length !== image.index.size || hash(raw) !== image.index.digest) throw Error('Remote registry digest conflict');
  captureRoleIndex(raw, image.platforms);
  const annotations = object(object(JSON.parse(raw.toString('utf8'))).annotations);
  if (annotations['org.opencontainers.image.revision'] !== plan.revision || annotations['dev.beetlestance.sources'] !== plan.sources.url
    || annotations['org.opencontainers.image.documentation'] !== `https://github.com/beetlestance/beetle-lab/releases/tag/${releaseTag(plan)}`)
    throw Error('Registry index source annotation mismatch');
}
/** Read-only preflight. Unknown availability/auth errors never mean 'absent'. */
export async function preflightRegistry(tool: RegistryCommands, plan: RegistryPlan): Promise<void> {
  const existing = await tags(tool, plan.repository);
  for (const image of plan.images) if (existing.includes(image.tag)) await verify(tool, `${plan.repository}:${image.tag}`, image, plan);
}
/** The workflow serializes this namespace. All installations use immutable digests.
 * An unrelated registry administrator remains capable of changing tags externally. */
export async function publishRegistry(tool: RegistryCommands, plan: RegistryPlan, layout: string): Promise<void> {
  for (const image of plan.images) {
    const local = `ocidir://${layout}@${image.index.digest}`;
    await verify(tool, local, image, plan);
    await tool.command(['image', 'copy', '--force-recursive', local, `${plan.repository}@${image.index.digest}`]);
    await verify(tool, `${plan.repository}@${image.index.digest}`, image, plan);
  }
  for (const image of plan.images) {
    const reference = `${plan.repository}:${image.tag}`;
    if ((await tags(tool, plan.repository)).includes(image.tag)) await verify(tool, reference, image, plan);
    else await tool.command(['image', 'copy', `${plan.repository}@${image.index.digest}`, reference]);
    await verify(tool, reference, image, plan);
  }
  // Final batch readback precedes any installer environment publication.
  await verifyPublishedRegistry(tool, plan);
}
export async function verifyPublishedRegistry(tool: RegistryCommands, plan: RegistryPlan): Promise<void> {
  for (const image of plan.images) await verify(tool, `${plan.repository}@${image.index.digest}`, image, plan);
}
