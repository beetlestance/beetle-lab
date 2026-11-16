import {expect, it} from 'vitest';
import type {Fixture} from '../compose/fixture.js';
import {starterPolicy} from '../../../install/starter/policy.js';
import {request, volumeOptions} from './fixture.js';
import {ownedVolume, removeOwned} from './cleanup.js';
import type {Docker} from '../../docker.js';
const owner = {root: '/private/tmp/beetle-compose-evidence-Abc123', project: 'beetle-qual-12345678', owner: '11111111-1111-4111-8111-111111111111', revision: 'a'.repeat(40)};
const volume = () => ({Name: owner.project+'-disk', Driver: 'local', Labels: {'dev.beetle.qualification': owner.owner, 'com.docker.compose.project': owner.project},
 Options: {type: 'tmpfs', device: 'tmpfs', o: volumeOptions}});
it('requires exact volume name, owner, project, driver and64MiB tmpfs mount policy', () => {
 expect(ownedVolume(volume(), owner)).toBe(owner.project+'-disk');
 for (const patch of [{Name: 'user-data'}, {Driver: 'foreign'}, {Labels: {}}, {Options: {type: 'ext4', device: '/dev/sda'}},
  {Options: {type: 'tmpfs', device: 'tmpfs', o: 'size=1073741824'}}]) expect(() => ownedVolume({...volume(), ...patch}, owner)).toThrow();
});
it('cannot stop containers or remove a volume after a foreign-volume custody mismatch', () => {
 const effects: string[] = [];
 const docker = {run: () => owner.project+'-disk', json: () => [{...volume(), Labels: {}}],
  ownedIds: () => {effects.push('inventory'); return [];}, cleanup: () => {effects.push('remove');}} as unknown as Docker;
 expect(() => removeOwned(docker, owner)).toThrow(); expect(effects).toEqual([]);
});
it('changes only the explicit test reserve, preserving shipped attempts, pools and engine limits', () => {
 const before = starterPolicy(); const f = {home: '/qual', origin: 'http://127.0.0.1:4567', agent: 'beetle-qual-12345678-agent', instance: 'qual-12345678',
  images: {agent: 'test/agent:source', engine: 'test/engine:source', offline: 'test/export:source'}} as Fixture;
 const result = request(f); expect(result.agentPolicy).toEqual(before.agentPolicy); expect(result.engine).toEqual(before.engine);
 expect({...result.installationValues.pool, freeSpaceReserveBytes: before.installationValues.pool.freeSpaceReserveBytes}).toEqual(before.installationValues.pool);
 expect(result.installationValues.perRunCeilings).toEqual(before.installationValues.perRunCeilings);
 expect(result.installationValues.pool.freeSpaceReserveBytes).toBe(0); expect(starterPolicy()).toEqual(before);
});
