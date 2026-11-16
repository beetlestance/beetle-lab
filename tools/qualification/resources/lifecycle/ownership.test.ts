import {expect, it} from 'vitest';
import {lifecycleOwner, installationOwner, boundedIds} from './ownership.js';
const owner = {project: 'beetle-qual-1234abcd', root: '/tmp/beetle-compose-evidence-Ab12cd', revision: 'a'.repeat(40), mode: 'cancel'};
it('accepts only a bounded qualification project and its exact installation owner', () => {
  expect(lifecycleOwner(owner)).toEqual(owner);
  const installationId = '00000000-0000-4000-8000-000000000001';
  expect(installationOwner({project: owner.project, installationId}, owner.project)).toBe(installationId);
  expect(() => installationOwner({project: 'foreign', installationId}, owner.project)).toThrow();
});
it('refuses ordinary projects, ambiguous ownership and malformed evidence roots', () => {
  for (const value of [{...owner, project: 'beetle-local'}, {...owner, root: '/'}, {...owner, root: '../owned'},
    {...owner, root: '/tmp/beetle-compose-evidence-Ab12cd/../other'}, {...owner, mode: 'all'}, {...owner, extra: true}]) expect(() => lifecycleOwner(value)).toThrow();
});
it('bounds exact daemon identities before destructive commands', () => {
  const id = 'a'.repeat(64); expect(boundedIds(id, 1)).toEqual([id]);
  for (const value of [id + '\n' + id, 'short', '-all']) expect(() => boundedIds(value, 1)).toThrow();
});
