import assert from 'node:assert/strict';
import {join, dirname} from 'node:path';
import {captureBundle} from '../../../delivery/bundle.js';
import {readDeliveryJson, deliveryDigest} from '../../../delivery/files.js';
import {archiveMember, archiveLocalIds} from '../../../delivery/contents.js';
import {maximumArchiveBytes} from '../../../delivery/identity.js';
import {fixture} from '../compose/fixture.js';
export async function candidate(bundlePath: string, context: string) {
const bundle = captureBundle(await readDeliveryJson(bundlePath));
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'export'] as const;
const archive = join(dirname(bundlePath), bundle.archive.name);
assert.deepEqual(await deliveryDigest(archive, maximumArchiveBytes), {bytes: bundle.archive.bytes, sha256: bundle.archive.sha256});
const cache = new Map<string, Buffer>(); const member = archiveMember(archive);
const identities = archiveLocalIds(name => {
  const saved = cache.get(name); if (saved) return saved; assert(cache.size < 16);
  const bytes = member(name); cache.set(name, bytes); return bytes;
}, bundle.references, bundle);
const f = await fixture([...roles.map(role => bundle.references[role]), context], 128);
assert.equal(bundle.revision, f.revision); assert.equal(bundle.architecture, f.architecture);
const images = f.docker.json<{Id: string; Size: number}[]>(['image', 'inspect', ...roles.map(role => bundle.references[role])]);
for (const [index, role] of roles.entries()) {assert.equal(identities[role].config, bundle.configs[role]); assert([identities[role].config, identities[role].manifest].includes(images[index]!.Id));}
return {f, bundle, roles, images, identities};
}
