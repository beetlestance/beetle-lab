import { expect, it } from 'vitest';
import { runtimeName } from '../../../agent/src/backends/docker/index.js';
import { verifyLiveVolume } from './live-volumes.js';
const f = {id: '00000000-0000-4000-8000-000000000001', user: '10001:10001'};
function volume() {
  const scope = {organizationId: '00000000-0000-4000-8000-000000000002', workspaceId: '00000000-0000-4000-8000-000000000003',
    attemptId: '00000000-0000-4000-8000-000000000004', generation: 1};
  const Name = `${runtimeName({...scope, installationId: f.id})}-live`;
  return {Name, Driver: 'local', Scope: 'local', Options: {type: 'tmpfs', device: 'tmpfs',
    o: 'rw,noexec,nosuid,nodev,size=131072,nr_inodes=4,uid=10001,gid=10001,mode=0700'},
    Labels: {'dev.beetle.installation': f.id, 'dev.beetle.organization': scope.organizationId, 'dev.beetle.workspace': scope.workspaceId,
      'dev.beetle.attempt': scope.attemptId, 'dev.beetle.generation': '1', 'dev.beetle.intent': 'a'.repeat(64),
      'dev.beetle.spec': 'b'.repeat(64), 'dev.beetle.purpose': 'live-mailbox'}};
}
it('binds task volume cleanup to exact name, owner, local tmpfs cap, uid and purpose', () => {
  const v = volume(); expect(() => verifyLiveVolume(f, v.Name, v)).not.toThrow();
  expect(() => verifyLiveVolume({...f, user: '10002:10002'}, v.Name, v)).toThrow();
  expect(() => verifyLiveVolume({...f, id: '00000000-0000-4000-8000-000000000099'}, v.Name, v)).toThrow();
  expect(() => verifyLiveVolume(f, v.Name, {...v, Driver: 'other'})).toThrow();
  expect(() => verifyLiveVolume(f, v.Name, {...v, Name: `${v.Name}-foreign`})).toThrow();
  expect(() => verifyLiveVolume(f, v.Name, {...v, Labels: {...v.Labels, 'dev.beetle.purpose': 'other'}})).toThrow();
  expect(() => verifyLiveVolume(f, v.Name, {...v, Options: {...v.Options, o: 'size=1048576'}})).toThrow();
});
