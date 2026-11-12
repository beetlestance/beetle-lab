import assert from 'node:assert/strict';
import { validatePrimitive } from '@beetle/contracts';
import { runtimeName } from '../../../agent/src/backends/docker/index.js';
import type { Fixture } from '../../../agent/test/container/fixture.js';
interface Volume {Name: string; Driver: string; Scope: string; Options: Record<string, string>; Labels: Record<string, string>}
/** Task-owned qualification cleanup only, after all matched containers are removed. */
export function cleanupLiveVolumes(f: Fixture): number {
  const names = f.docker.run(['volume', 'ls', '-q', '--filter', `label=dev.beetle.installation=${f.id}`]).split('\n').filter(Boolean);
  assert(names.length <= 4); let removed = 0;
  for (const name of names) {
    assert.match(name, /^beetle-[a-f0-9]{64}-live$/);
    const volumes = f.docker.json<Volume[]>(['volume', 'inspect', name]); assert.equal(volumes.length, 1);
    verifyLiveVolume(f, name, volumes[0]!);
    assert.equal(f.docker.run(['ps', '-aq', '--no-trunc', '--filter', `volume=${name}`]), '');
    f.docker.run(['volume', 'rm', name]); removed++;
  }
  assert.equal(f.docker.run(['volume', 'ls', '-q', '--filter', `label=dev.beetle.installation=${f.id}`]), '');
  return removed;
}
export function verifyLiveVolume(f: Readonly<{id: string; user: string}>, name: string, volume: Volume): void {
  assert(validatePrimitive('uuid', f.id).ok); assert(/^[1-9][0-9]{0,9}:[1-9][0-9]{0,9}$/.test(f.user));
  assert.equal(volume.Name, name); assert.equal(volume.Driver, 'local'); assert.equal(volume.Scope, 'local');
  const labels = volume.Labels;
  assert.equal(Object.keys(labels).length, 8); assert.equal(labels['dev.beetle.installation'], f.id);
  assert.equal(labels['dev.beetle.purpose'], 'live-mailbox'); assert.equal(labels['dev.beetle.generation'], '1');
  for (const field of ['organization', 'workspace', 'attempt']) assert(validatePrimitive('uuid', labels[`dev.beetle.${field}`]).ok);
  for (const field of ['intent', 'spec']) assert.match(labels[`dev.beetle.${field}`]!, /^[a-f0-9]{64}$/);
  assert.equal(name, `${runtimeName({installationId: f.id, organizationId: labels['dev.beetle.organization']!,
    workspaceId: labels['dev.beetle.workspace']!, attemptId: labels['dev.beetle.attempt']!, generation: 1})}-live`);
  const [uid, gid] = f.user.split(':');
  assert.deepEqual(volume.Options, {type: 'tmpfs', device: 'tmpfs',
    o: `rw,noexec,nosuid,nodev,size=131072,nr_inodes=4,uid=${uid},gid=${gid},mode=0700`});
}
