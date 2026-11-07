import { expect, expectTypeOf, it, vi } from 'vitest';
import { createHttpTransport, createRunnerClient, runnerSchemas, runnerMessageSchemas, validate } from '../src/index.js';
import type { AgentEvent, ControlEvent, EngineResult, Offer } from '../src/index.js';
import { fixture } from './fixtures.js';

const baseUrl = 'http://w01.synthetic.invalid';
const offer = await fixture('valid/offer.json') as Offer;
const attemptId = offer.attemptId;
const options = { baseUrl, timeoutMs: 5 };

it('preserves useful event/result discriminants in generated types', () => {
  expectTypeOf<Extract<ControlEvent, { kind: 'progress' }>['payload']['completedUnits']>().toEqualTypeOf<number>();
  expectTypeOf<Extract<AgentEvent, { source: 'wrapper'; kind: 'progress' }>['wrapperSeq']>().toEqualTypeOf<number>();
  expectTypeOf<Extract<EngineResult, { outcome: 'passed' }>['completeness']>().toEqualTypeOf<'complete'>();
});

it('freezes all shipped schema trees, catalogue containers and nested arrays before use', () => {
  const pending: unknown[] = [runnerSchemas, runnerMessageSchemas];
  let nodes = 0;
  while (pending.length) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') continue;
    expect(Object.isFrozen(value)).toBe(true);
    pending.push(...Object.values(value)); nodes++;
  }
  expect(nodes).toBeGreaterThan(100);
  expect(Reflect.set(runnerMessageSchemas.Offer.properties.protocolVersion, 'const', '2.0')).toBe(false);
  expect(Reflect.set(runnerSchemas, '0', {})).toBe(false);
  expect(validate('Offer', offer).ok).toBe(true);
});

it('rejects object and indexed accessors before AJV or serialization can call them', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const runner = createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher }));
  for (const path of ['budget', 'index']) {
    const input = structuredClone(offer);
    const getter = vi.fn(() => { throw new Error('synthetic-secret-canary'); });
    if (path === 'budget') Object.defineProperty(input, 'budget', { enumerable: true, get: getter });
    else Object.defineProperty(input.inputs, '0', { enumerable: true, get: getter });
    const result = await runner.offer(attemptId, input);
    expect(result).toEqual({ ok: false, error: { kind: 'request' } });
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('canary');
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects malformed UUID/path encodings and unsafe cursors before fetch', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const runner = createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher }));
  for (const id of ['', 'attempt', '..', '../private', '%2e%2e', '%', '/path', '\ud800']) {
    const result = await runner.snapshot(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('request');
  }
  for (const cursor of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await runner.events(attemptId, cursor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('request');
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('accepts both safe integer cursor extremes with schema-validated UUIDs', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(await fixture('valid/events.json')));
  const runner = createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher }));
  for (const cursor of [0, Number.MAX_SAFE_INTEGER]) {
    expect((await runner.events(attemptId, cursor)).ok).toBe(true);
  }
  expect(fetcher.mock.calls.map(call => new URL(String(call[0])).search)).toEqual(['?after=0', '?after=9007199254740991']);
});

it('times out a stalled injected body even when cancellation never settles, without retry', async () => {
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel })));
  const runner = createRunnerClient(createHttpTransport({ ...options, fetch: fetcher }));
  const result = await runner.capabilities();
  expect(result).toEqual({ ok: false, error: { kind: 'timeout', status: 200 } });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('distinguishes caller abort from deadline during a stalled injected body', async () => {
  const controller = new AbortController();
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel })));
  const runner = createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher, timeoutMs: 500 }));
  const pending = runner.capabilities(controller.signal);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  controller.abort();
  expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled', status: 200 } });
  expect(cancel).toHaveBeenCalledTimes(1);
});
