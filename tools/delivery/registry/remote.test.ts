import {expect, it} from 'vitest';
import {publicationFixture} from './fixture.js';
import {preflightRegistry, publishRegistry} from './remote.js';
import type {RegistryCommands} from './remote.js';
import {captureRegistryPlan, composeEnvironment} from './value.js';
function fixture() {
  const {plan, bodies} = publicationFixture(); const tags = new Map<string, Buffer>(); const remote = new Map<string, Buffer>(); const writes: string[] = [];
  const tool: RegistryCommands = {
    raw: async args => {
      if (args[0] === 'tag') return Buffer.from(JSON.stringify([...tags.keys()]));
      const ref = args[2]!;
      if (ref.startsWith('ocidir:')) return bodies.get(ref.slice(ref.lastIndexOf('@') + 1))!;
      const value = ref.includes('@') ? remote.get(ref.split('@')[1]!) : tags.get(ref.slice(ref.lastIndexOf(':') + 1));
      if (!value) throw Error('Synthetic remote unavailable'); return value;
    },
    command: async args => {
      const source = args.at(-2)!; const target = args.at(-1)!; writes.push(target);
      if (target.includes('@')) remote.set(target.split('@')[1]!, bodies.get(source.split('@')[1]!)!);
      else tags.set(target.slice(target.lastIndexOf(':') + 1), remote.get(source.split('@')[1]!)!);
    },
  };
  return {plan, tool, writes, tags, remote};
}
it('copies all immutable indexes before checked convenience tags and supports exact replay', async () => {
  const f = fixture(); await preflightRegistry(f.tool, f.plan); expect(f.writes).toHaveLength(0);
  await publishRegistry(f.tool, f.plan, '/synthetic/layout');
  expect(f.writes.slice(0, 6).every(ref => ref.includes('@sha256:'))).toBe(true); expect(f.tags.size).toBe(6);
  f.writes.length = 0; await preflightRegistry(f.tool, f.plan); await publishRegistry(f.tool, f.plan, '/synthetic/layout');
  expect(f.writes).toHaveLength(6); expect(f.writes.every(ref => ref.includes('@sha256:'))).toBe(true);
});
it('refuses existing tag conflicts and availability failures without writing', async () => {
  const f = fixture(); f.tags.set(f.plan.images[0]!.tag, Buffer.from('conflicting'));
  await expect(preflightRegistry(f.tool, f.plan)).rejects.toThrow('conflict'); expect(f.writes).toHaveLength(0);
  const g = fixture(); g.tool.raw = async () => {throw Error('Synthetic authentication failure');};
  await expect(preflightRegistry(g.tool, g.plan)).rejects.toThrow(); expect(g.writes).toHaveLength(0);
});
it('stops on missing remote readback and requires exactly six candidate/digest environment bindings', async () => {
  const f = fixture(); f.tool.command = async () => {};
  await expect(publishRegistry(f.tool, f.plan, '/synthetic/layout')).rejects.toThrow('unavailable');
  const {plan} = publicationFixture(); expect(captureRegistryPlan(plan)).toEqual(plan);
  const env = composeEnvironment(plan); expect(env.trim().split('\n')).toHaveLength(6); expect(env).toContain('BEETLE_EXPORT_IMAGE=ghcr.io/beetlestance/beetle-lab@sha256:');
  expect(() => captureRegistryPlan({...plan, repository: 'other/repository'})).toThrow();
  expect(() => captureRegistryPlan({...plan, images: [...plan.images.slice(0, 5), plan.images[0]]})).toThrow('Duplicate');
});
