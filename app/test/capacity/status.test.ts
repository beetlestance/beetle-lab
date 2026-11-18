import { describe, expect, it } from 'vitest';
import type { AgentSampleOutcome } from '../../src/ports/installation-status.js';
import { openSource } from '../../src/adapters/outbound/capacity/source.js';
import { capabilities, fixture } from './fixture.js';

async function recorded(setup?: (f: Awaited<ReturnType<typeof fixture>>) => void, throwing = false) {
  const f = await fixture();
  const outcomes: AgentSampleOutcome[] = [];
  const status = {
    record: (outcome: AgentSampleOutcome) => {
      outcomes.push(outcome);
      if (throwing) throw new Error('synthetic recorder fault');
    },
  };
  setup?.(f);
  const source = await openSource(
    { dataRoot: f.root, configuration: f.state.configuration, gateway: f.gateway, status },
    f.disk,
    () => f.state.now,
  );
  return { f, source, outcomes };
}

describe('agent status recording from the capacity source', () => {
  it('records measured facts only from a fully checked frame, with daemon totals only when published', async () => {
    const { f, source, outcomes } = await recorded((f) => {
      f.state.frame.observation.daemonCapacity = { cpuMillis: 8000, memoryBytes: 16384 };
    });
    try {
      expect(await source.sample()).not.toBeNull();
      expect(outcomes).toHaveLength(1);
      const [ready] = outcomes;
      expect(ready).toMatchObject({ kind: 'ready', checkedAtMs: 10100 });
      if (ready?.kind !== 'ready') throw new Error('expected ready');
      expect(ready.facts).toMatchObject({
        observedAtMs: 10000,
        daemon: { cpuMillis: 8000, memoryBytes: 16384 },
        stagingFreeBytes: 1,
        imageDigests: [`sha256:${'d'.repeat(64)}`],
      });
      expect(ready.facts.engines?.[0]).toMatchObject({
        profileId: f.state.frame.engines[0]!.installedIdentity.profileId,
        id: f.state.frame.engines[0]!.id,
        version: f.state.frame.engines[0]!.version,
        imageDigest: f.state.frame.engines[0]!.imageDigest,
        configVersion: f.state.frame.engines[0]!.configVersion,
      });
      expect(ready.facts.backendDisk.totalBytes).toBeGreaterThan(0);
      f.state.frame = capabilities(10500);
      f.state.now = 11100;
      await source.sample();
      const second = outcomes.at(-1);
      expect(second?.kind === 'ready' ? second.facts.daemon : 'missing').toBeNull();
    } finally {
      await source.close();
      await f.cleanup();
    }
  });

  it('records unreachable for transport and timeout failures and unavailable for refusals or invalid frames', async () => {
    const { f, source, outcomes } = await recorded();
    try {
      f.calls.mockResolvedValueOnce({ ok: false, error: { kind: 'transport' } });
      expect(await source.sample()).toBeNull();
      f.calls.mockResolvedValueOnce({ ok: false, error: { kind: 'timeout' } });
      await source.sample();
      f.calls.mockResolvedValueOnce({ ok: false, error: { kind: 'protocol', status: 503 } });
      await source.sample();
      const foreign = capabilities();
      foreign.observation.installationId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
      f.calls.mockResolvedValueOnce({ ok: true, value: foreign });
      await source.sample();
      expect(outcomes.map((outcome) => outcome.kind)).toEqual([
        'unreachable',
        'unreachable',
        'unavailable',
        'unavailable',
      ]);
    } finally {
      await source.close();
      await f.cleanup();
    }
  });

  it('never lets recorder faults change the capacity outcome and records nothing after close', async () => {
    const { f, source, outcomes } = await recorded(undefined, true);
    try {
      expect((await source.sample())?.observedAtMs).toBe(10000);
      await source.close();
      f.calls.mockResolvedValueOnce({ ok: false, error: { kind: 'transport' } });
      expect(await source.sample()).toBeNull();
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(['ready']);
    } finally {
      await source.close();
      await f.cleanup();
    }
  });
});
