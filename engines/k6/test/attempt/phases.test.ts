import { afterEach, expect, it, vi } from 'vitest';
import type { ControlEvent, EngineManifest } from '@beetle/contracts';
import type { ControlDraft, ControlWriter } from '../../wrapper/control/index.js';
import { AttemptFence } from '../../wrapper/attempt/fence.js';
import { Notifications } from '../../wrapper/attempt/notifications.js';
import { Phases } from '../../wrapper/attempt/phases.js';

const disposals: (() => void)[] = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); vi.useRealTimers(); });
function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>(yes => { resolve = yes; }), resolve: () => resolve() };
}
function setup() {
  vi.useFakeTimers();
  const parent = new AbortController();
  const fence = new AttemptFence({ wall: () => 1_800_000_000_000, monotonic: () => performance.now() }, parent.signal, 60_000);
  disposals.push(() => fence.dispose());
  const gate = deferred(); const drafts: ControlDraft[] = []; let seq = 0;
  const writer: ControlWriter = { append: async draft => {
    drafts.push(draft); if (draft.kind === 'progress') await gate.promise;
    return { ...draft, seq: ++seq } as ControlEvent;
  }, close: async () => undefined };
  const scope = { organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
    attemptId: '00000000-0000-4000-8000-000000000003', generation: 1 };
  const manifest = { phases: ['validate', 'prepare', 'execute', 'collect', 'seal'].map(phase => ({ phase,
    timeoutMs: 60_000, outputBytes: 1_048_576, workUnits: 1 })) } as EngineManifest;
  const phases = new Phases(writer, scope, manifest, fence, new Notifications(undefined, fence));
  return { phases, fence, parent, gate, drafts };
}
it('awaits the original deferred heartbeat on stop and never rearms it', async () => {
  const f = setup(); await f.phases.start('validate'); await vi.advanceTimersByTimeAsync(5000);
  expect(f.drafts.map(draft => draft.kind)).toEqual(['phase.started', 'progress']);
  let settled = false; const stopping = f.phases.stop().then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  f.gate.resolve(); await stopping; await vi.advanceTimersByTimeAsync(20_000);
  expect(f.drafts).toHaveLength(2); await expect(f.phases.start('prepare')).rejects.toMatchObject({ reason: 'journal' });
});
it('invalidates a deferred old heartbeat when transitioning and arms only the new phase', async () => {
  const f = setup(); await f.phases.start('validate'); await vi.advanceTimersByTimeAsync(5000);
  const transition = f.phases.transition('prepare', 1); f.gate.resolve(); await transition;
  expect(f.drafts.map(draft => [draft.kind, draft.phase])).toEqual([
    ['phase.started', 'validate'], ['progress', 'validate'], ['phase.finished', 'validate'], ['phase.started', 'prepare']]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.drafts.filter(draft => draft.kind === 'progress').map(draft => draft.phase)).toEqual(['validate', 'prepare']);
  await f.phases.stop(); await vi.advanceTimersByTimeAsync(10_000); expect(f.drafts).toHaveLength(5);
});
it('finish and result cannot rearm an earlier pending heartbeat', async () => {
  const f = setup(); await f.phases.start('validate'); await vi.advanceTimersByTimeAsync(5000);
  const finishing = f.phases.finish(1); f.gate.resolve(); await finishing;
  await vi.advanceTimersByTimeAsync(10_000); expect(f.drafts).toHaveLength(3);
  await f.phases.start('seal'); await vi.advanceTimersByTimeAsync(5000);
  const event = { ...f.drafts[0]!, phase: 'seal' } as ControlDraft;
  await f.phases.result(event); const count = f.drafts.length;
  await vi.advanceTimersByTimeAsync(10_000); expect(f.drafts).toHaveLength(count); await f.phases.stop();
});
it('captures synchronous cancelled-fence draft failure while cleanup is still pending', async () => {
  const f = setup(); await f.phases.start('validate');
  const cleanup = deferred(); let cleaned = false;
  const pendingCleanup = cleanup.promise.then(() => { cleaned = true; });
  f.parent.abort();
  await vi.advanceTimersByTimeAsync(5000);
  expect(cleaned).toBe(false); expect(f.drafts).toHaveLength(1); expect(f.fence.reason).toBe('cancelled');
  await expect(f.phases.stop()).rejects.toMatchObject({ reason: 'cancelled' });
  await vi.advanceTimersByTimeAsync(10_000); expect(f.drafts).toHaveLength(1);
  cleanup.resolve(); await pendingCleanup;
});
it('retains a cancelled deferred original heartbeat rejection without uncaught timer failure', async () => {
  const f = setup(); await f.phases.start('validate'); await vi.advanceTimersByTimeAsync(5000);
  f.parent.abort(); const stopped = f.phases.stop();
  const rejected = expect(stopped).rejects.toMatchObject({ reason: 'cancelled' });
  f.gate.resolve(); await rejected; await vi.advanceTimersByTimeAsync(15_000); expect(f.drafts).toHaveLength(2);
});
it('result invalidates its pending heartbeat before that append can settle', async () => {
  const f = setup(); await f.phases.start('seal'); await vi.advanceTimersByTimeAsync(5000);
  const result = f.phases.result(f.drafts[0]!); f.gate.resolve(); await result;
  const count = f.drafts.length; await vi.advanceTimersByTimeAsync(15_000);
  expect(f.drafts).toHaveLength(count); await f.phases.stop();
});
