import { expect, it } from 'vitest';
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { NamespaceBinding, verifyInstallation, retirementRoot } from '../../src/staging/index.js';
import { TaskInventory } from '../../src/task-inventory/index.js';
import { NativeRemoval } from '../../src/native-removal/index.js';
import { NativeReceipt } from '../../src/native-receipt/index.js';
import { RetirementPipeline } from '../../src/retirement-pipeline/index.js';
import { producerBarrierFacts } from '../../src/producer-retirement/index.js';
import { renumberRoot } from '../staging/fixtures.js';
import { fixture } from './fixtures.js';
const f = fixture();
const operation = () => ({ deadline: performance.now() + 10000 });
async function tree(path: string): Promise<string[]> {
  const entries = await readdir(path, { recursive: true });
  return entries.map(String).sort();
}
// A task folder prepared before the root was renumbered carries directory facts that no longer
// match. The namespace still binds, but cleanup must refuse that folder rather than delete it.
// The control case restarts without renumbering and cleans the same folder, so the refusal is
// caused by the stale directory facts and nothing else.
it.each([true, false])(
  'restart on a fresh root binding, renumbered=%s: refuses or cleans the recorded task folder',
  async (renumbered) => {
    const e = await f.inventory();
    const request = producerBarrierFacts(e.producer, e.owner.retirements).intent.request;
    const before = await tree(e.task);
    const recorded = await e.owner.stagingNamespace.read();
    if (recorded?.state !== 'bound') throw new Error('Missing bound namespace');
    if (renumbered) await renumberRoot(e.rootPath);
    const verified = await verifyInstallation({
      configuration: e.configuration,
      transport: e.transport,
      operation: operation(),
    });
    if (!verified.ok) throw new Error(verified.reason);
    const binding = new NamespaceBinding({
      root: verified.value,
      journal: e.owner.stagingNamespace,
      journalAuthority: await e.owner.journalAuthority(),
      operation: operation(),
    });
    try {
      expect(await binding.bind()).toEqual(recorded.anchor);
    } finally {
      await binding.close();
    }
    expect(retirementRoot(verified.value).native.ino).toBe(String((await lstat(e.rootPath, { bigint: true })).ino));

    const inventory = new TaskInventory({ journal: e.owner, root: verified.value });
    const removal = new NativeRemoval({ journal: e.owner, root: verified.value });
    const receipt = new NativeReceipt({ journal: e.owner, root: verified.value, removal });
    const pipeline = new RetirementPipeline({
      journal: e.owner,
      producer: e.coordinator,
      runtime: e.runtime,
      inventory,
      removal,
      receipt,
      maximumSteps: 16,
    });
    const effects: string[] = [];
    const ports = {
      inventory: e.ports,
      removal: {
        ...e.ports,
        unlink: async (path: string) => {
          effects.push(path);
          await unlink(path);
        },
        rmdir: async (path: string) => {
          effects.push(path);
          await rmdir(path);
        },
      },
    };
    try {
      const work = pipeline.tickWithPorts(request, operation(), ports);
      if (renumbered) {
        await expect(work.result).rejects.toBeTruthy();
        await expect(work.settled).rejects.toBeTruthy();
      } else {
        expect(await work.result).toMatchObject({ state: 'cleaned' });
        await work.settled;
      }
    } finally {
      await pipeline.close();
      await receipt.close();
      await removal.close();
      await inventory.close();
    }
    const plan = await e.owner.cleanupPlans.read(e.key);
    if (renumbered) {
      expect(effects).toEqual([]);
      expect(await tree(e.task)).toEqual(before);
      if (plan) expect(await e.owner.cleanupReceipts.read(plan.plan)).toBeNull();
    } else {
      expect(effects.length).toBeGreaterThan(0);
      await expect(lstat(e.task)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await e.owner.stagingNamespace.read()).toEqual(recorded);
  },
);
