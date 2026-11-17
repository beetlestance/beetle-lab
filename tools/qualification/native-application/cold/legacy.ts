import assert from 'node:assert/strict';
import type { Fixture } from '../compose/fixture.js';
import { capturePublishedPlan } from '../../../delivery/registry/value.js';
import { readDeliveryJson } from '../../../delivery/files.js';
import { verifyLoadedImage } from '../../../delivery/registry/native-value.js';
export interface LegacyReader {
  readonly revision: string;
  readonly installer: string;
  readonly frontend: string;
  readonly imageIds: Readonly<Record<string, string>>;
}
/** Two already published, immutable reader roles; no pulls or mixed unverified tags. */
export async function legacyReader(path: string, f: Fixture): Promise<LegacyReader> {
  const plan = capturePublishedPlan(await readDeliveryJson(path));
  assert.notEqual(plan.revision, f.revision);
  const refs: Record<string, string> = {};
  const imageIds: Record<string, string> = {};
  for (const role of ['installer', 'frontend'] as const) {
    const image = plan.images.find((image) => image.role === role);
    assert(image);
    const ref = `${plan.repository}@${image.index.digest}`;
    const rows = f.docker.json<{ Id: string }[]>(['image', 'inspect', ref]);
    assert.equal(rows.length, 1);
    verifyLoadedImage(rows[0], plan, role, f.architecture as 'amd64' | 'arm64');
    refs[role] = ref;
    imageIds[role] = rows[0]!.Id;
  }
  return { revision: plan.revision, installer: refs.installer!, frontend: refs.frontend!, imageIds };
}
