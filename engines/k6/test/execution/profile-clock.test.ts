import { expect, it } from 'vitest';
import type { BuildOutput } from '../../build/index.js';
import { runCompiledK6 } from '../../wrapper/execution/index.js';
import type { ExecutionLimits, ExecutionOptions } from '../../wrapper/execution/index.js';
import { deferred, flush, launch, setup } from './fixtures.js';

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects nonpositive/unsafe invocation allowances %s before any build', async value => {
  const f = setup(); const operation = runCompiledK6({ ...f.options, limits: { ...f.options.limits, reservedOutputBytes: value } });
  expect(await operation.result).toMatchObject({ ok: false, code: 'profile', build: null }); await operation.quiesced;
});
it.each(['maximumBuildBytes', 'maximumMetricBytes', 'maximumMetricRecords', 'maximumDiagnosticBytes', 'drainTimeoutMs', 'collectionTimeoutMs'] as const)(
  'rejects zero %s before any build', async key => {
    const f = setup(); const operation = runCompiledK6({ ...f.options, limits: { ...f.options.limits, [key]: 0 } });
    expect(await operation.result).toMatchObject({ ok: false, code: 'profile' }); await operation.quiesced;
  });
it.each([{ maximumDiagnosticBytes: 65_537 }, { drainTimeoutMs: 1001 }, { collectionTimeoutMs: 30_001 },
  { maximumBuildBytes: Number.MAX_SAFE_INTEGER }, { reservedOutputBytes: 1_114_111 }] satisfies Partial<ExecutionLimits>[])(
  'rejects over-ceiling or insufficient reservation %j', async changed => {
    const f = setup(); const operation = runCompiledK6({ ...f.options, limits: { ...f.options.limits, ...changed } });
    expect(await operation.result).toMatchObject({ ok: false, code: 'profile' }); await operation.quiesced;
  });
it.each(['relative/path', '/owned/../other', '/owned/\0bad'])('rejects noncanonical trusted paths %j', async path => {
  const f = setup(); const operation = runCompiledK6({ ...f.options, binary: path });
  expect(await operation.result).toMatchObject({ ok: false, code: 'profile' }); await operation.quiesced;
});
it.each([NaN, -1, 1.5, 8_640_000_000_000_001])('fences invalid wall clock %s before build', async wall => {
  const f = setup(); f.state.wall = wall; const operation = launch(f.options, f.ports);
  expect(await operation.result).toMatchObject({ ok: false, code: 'clock' }); await operation.quiesced; expect(f.state.built).toBe(0);
});
it.each([NaN, -1, Infinity])('fences invalid monotonic clock %s before build', async mono => {
  const f = setup(); f.state.mono = mono; const operation = launch(f.options, f.ports);
  expect(await operation.result).toMatchObject({ ok: false, code: 'clock' }); await operation.quiesced;
});
it('rejects a managed deadline whose admission time is still in the future', async () => {
  const f = setup(); const operation = launch({ ...f.options,
    compiled: { suite: f.options.compiled.suite, attempt: { mode: 'managed', timeoutMs: 1000, deadlineMs: 10_000 } } }, f.ports);
  expect(await operation.result).toMatchObject({ ok: false, code: 'clock' }); await operation.quiesced; expect(f.state.built).toBe(0);
});
it('rejects already-expired admitted time without a fresh execution deadline', async () => {
  const f = setup(); f.state.wall = 10_000; const operation = launch(f.options, f.ports);
  expect(await operation.result).toMatchObject({ ok: false, code: 'deadline' }); await operation.quiesced; expect(f.state.built).toBe(0);
});
it.each(['wall', 'mono'] as const)('fences %s rollback across awaited build and never launches late', async clock => {
  const f = setup(); f.state.mono = 10; const gate = deferred<BuildOutput>();
  const operation = launch(f.options, { ...f.ports, build: () => gate.promise }); await flush();
  if (clock === 'wall') f.state.wall = 1999; else f.state.mono = 9;
  gate.resolve({ scriptPath: '/owned/output/suite.js', bytes: 100, peakBytes: 200 });
  expect(await operation.result).toMatchObject({ ok: false, code: 'clock', process: null }); await operation.quiesced;
  expect(f.state.created).toBe(0);
});
it('does not reset its monotonic allowance when build consumed all remaining time', async () => {
  const f = setup(); const operation = launch(f.options, { ...f.ports, build: async () => {
    f.state.mono = 8000; return { scriptPath: '/owned/output/suite.js', bytes: 100, peakBytes: 200 };
  } });
  expect(await operation.result).toMatchObject({ ok: false, code: 'deadline', process: null }); await operation.quiesced;
});
it('captures mutable options, callbacks, attempt and private factories before execution begins', async () => {
  const f = setup(); const input = { ...f.options, limits: { ...f.options.limits },
    compiled: { ...f.options.compiled, attempt: { ...f.options.compiled.attempt } }, clock: { ...f.options.clock! } };
  const ports = { ...f.ports }; const operation = launch(input, ports);
  input.limits.maximumBuildBytes = 1; input.compiled.attempt.deadlineMs = 0; input.clock.wall = () => { throw new Error('changed'); };
  input.measureStarted = async () => { throw new Error('changed'); }; ports.build = async () => { throw new Error('changed'); };
  expect(await operation.result).toMatchObject({ ok: true }); await operation.quiesced;
  expect(f.markers).toHaveLength(1); expect(f.nativeOptions()!.attempt).toEqual(f.options.compiled.attempt);
});
it('contains a throwing clock callback without exposing its error text', async () => {
  const f = setup(); const operation = launch({ ...f.options, clock: { wall: () => { throw new Error('clock-canary'); }, monotonic: () => 0 } }, f.ports);
  const receipt = await operation.result; expect(receipt).toMatchObject({ ok: false, code: 'clock' });
  expect(JSON.stringify(receipt)).not.toContain('clock-canary'); await operation.quiesced;
});
it('fences reentrant close from the first clock before calling another external clock', async () => {
  const f = setup(); let monotonicCalls = 0;
  const operation: ReturnType<typeof launch> = launch({ ...f.options, clock: { wall: () => { void operation.close(); return 2000; }, monotonic: () => { monotonicCalls++; return 0; } } }, f.ports);
  expect(await operation.result).toMatchObject({ ok: false, code: 'closed' }); await operation.quiesced;
  expect(monotonicCalls).toBe(0); expect(f.state.built).toBe(0);
});
it.each([-1, 1.1, NaN])('rejects invalid owned UID %s', async uid => {
  const f = setup(); expect(await runCompiledK6({ ...f.options, uid }).result).toMatchObject({ ok: false, code: 'profile' });
});
it('rejects standalone mode at the admitted execution boundary', async () => {
  const f = setup(); const options = { ...f.options, compiled: { suite: f.options.compiled.suite,
    attempt: { mode: 'standalone', timeoutMs: 1000 } } } as unknown as ExecutionOptions;
  expect(await runCompiledK6(options).result).toMatchObject({ ok: false, code: 'profile' });
});
