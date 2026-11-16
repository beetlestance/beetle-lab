import { expect, it, vi } from 'vitest';
import { MetricStream } from '../../aggregation/index.js';
import type { MetricPoint, MetricStreamOptions } from '../../aggregation/index.js';
const encoder = new TextEncoder();
const signal = () => new AbortController().signal;
const line = (value: unknown) => encoder.encode(JSON.stringify(value) + '\n');
const declaration = (metric = 'http_req_duration', kind = 'trend') => ({ type: 'Metric', metric, data: { type: kind, contains: 'time', name: metric } });
const sample = (value = 3, tags: unknown = { request: 'r0' }, metric = 'http_req_duration') => ({ type: 'Point', metric,
  data: { time: '2026-11-07T12:00:00.123456789Z', value, tags } });
function setup(overrides: Partial<MetricStreamOptions> = {}) {
  const points: MetricPoint[] = [];
  const point = vi.fn(async (value: MetricPoint) => { points.push(value); });
  const stream = new MetricStream({ metrics: [{ name: 'http_req_duration', kind: 'trend' }, { name: 'beetle_requests', kind: 'counter' },
    { name: 'http_req_failed', kind: 'rate' }, { name: 'vus', kind: 'gauge' }], requestLabels: ['r0'], assertionLabels: ['a0'],
    maximumBytes: 1_000_000, maximumRecords: 100, point, ...overrides });
  return { stream, points, point };
}

it('decodes every byte boundary and forwards only fixed numeric/label projections', async () => {
  const { stream, points } = setup();
  const first = line(declaration()); const second = line(sample());
  const bytes = Buffer.concat([first, second]);
  for (const byte of bytes) await stream.push(Uint8Array.of(byte), signal());
  expect(stream.finish()).toEqual({ bytes: bytes.length, records: 2 });
  expect(points).toEqual([{ metric: 'http_req_duration', kind: 'trend', value: 3,
    timeMs: Date.parse('2026-11-07T12:00:00.123Z'), tags: { request: 'r0' } }]);
  expect(Object.isFrozen(points[0])).toBe(true); expect(Object.isFrozen(points[0]!.tags)).toBe(true);
  await expect(stream.push(line(sample()), signal())).rejects.toMatchObject({ code: 'closed' });
});

it('allows only compiled singleton labels and null/empty aggregate tags', async () => {
  for (const tags of [null, {}, { assertion: 'a0' }]) {
    const { stream, points } = setup();
    await stream.push(Buffer.concat([line(declaration()), line(sample(1, tags))]), signal());
    expect(points).toHaveLength(1); stream.finish();
  }
  for (const tags of [{ url: 'PRIVATE_SENTINEL' }, { request: 'r99' }, { assertion: 'a99' }, { request: 'r0', assertion: 'a0' }, []]) {
    const { stream, point } = setup();
    await expect(stream.push(Buffer.concat([line(declaration()), line(sample(1, tags))]), signal()))
      .rejects.toMatchObject({ code: expect.stringMatching(/^invalid_/) });
    expect(point).not.toHaveBeenCalled();
    await expect(stream.push(line(sample()), signal())).rejects.toBeDefined();
  }
});

it.each([
  ['unknown_metric', declaration('PRIVATE_SENTINEL')], ['invalid_record', declaration('http_req_duration', 'counter')],
  ['invalid_record', sample()], ['invalid_record', { ...declaration(), secret: 'PRIVATE_SENTINEL' }],
  ['invalid_record', { type: 'Error', metric: 'http_req_duration', data: { error: 'PRIVATE_SENTINEL' } }],
])('rejects %s without exposing raw values', async (code, value) => {
  const { stream } = setup();
  const error = await stream.push(line(value), signal()).catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code }); expect(String(error)).not.toContain('PRIVATE_SENTINEL');
});

it('requires unique declarations and valid finite sample numbers and time', async () => {
  const duplicate = setup().stream;
  await expect(duplicate.push(Buffer.concat([line(declaration()), line(declaration())]), signal())).rejects.toMatchObject({ code: 'invalid_record' });
  for (const value of [-1, null, '3', Number.POSITIVE_INFINITY]) {
    const { stream } = setup();
    await expect(stream.push(Buffer.concat([line(declaration()), line(sample(value as number))]), signal())).rejects.toMatchObject({ code: 'invalid_record' });
  }
  for (const [metric, kind, value] of [['beetle_requests', 'counter', 1.5], ['http_req_failed', 'rate', 2]] as const) {
    const { stream } = setup();
    await expect(stream.push(Buffer.concat([line(declaration(metric, kind)), line(sample(value, {}, metric))]), signal())).rejects.toMatchObject({ code: 'invalid_record' });
  }
  const { stream } = setup();
  const value = sample(); value.data.time = 'PRIVATE_SENTINEL';
  await expect(stream.push(Buffer.concat([line(declaration()), line(value)]), signal())).rejects.toMatchObject({ code: 'invalid_record' });
});

it('bounds bytes, records, frame and chunk before forwarding incomplete data', async () => {
  const bytes = setup({ maximumBytes: 2 }).stream;
  await expect(bytes.push(Uint8Array.of(1, 2, 3), signal())).rejects.toMatchObject({ code: 'stream_limit' });
  const records = setup({ maximumRecords: 1 }).stream;
  await expect(records.push(Buffer.concat([line(declaration()), line(sample())]), signal())).rejects.toMatchObject({ code: 'record_limit' });
  const frame = setup().stream;
  await expect(frame.push(new Uint8Array(65_537), signal())).rejects.toMatchObject({ code: 'line_limit' });
  const chunk = setup({ maximumBytes: 10_000_000 }).stream;
  await expect(chunk.push(new Uint8Array(1_048_577), signal())).rejects.toMatchObject({ code: 'stream_limit' });
  const torn = setup().stream;
  await torn.push(encoder.encode('{'), signal());
  expect(() => torn.finish()).toThrowError(expect.objectContaining({ code: 'torn_record' }));
});

it('rejects malformed UTF8/JSON/empty records without retaining diagnostics', async () => {
  for (const bytes of [Uint8Array.of(0xff, 10), encoder.encode('PRIVATE_SENTINEL\n'), encoder.encode('\n')]) {
    const { stream } = setup();
    await expect(stream.push(bytes, signal())).rejects.toMatchObject({ code: 'invalid_record' });
  }
});

it('snapshots mutable profile and chunk before asynchronous consumption', async () => {
  const metrics: MetricStreamOptions['metrics'][number][] = [{ name: 'http_req_duration', kind: 'trend' }];
  const requestLabels = ['r0']; const { stream, points } = setup({ metrics, requestLabels });
  metrics[0] = { name: 'PRIVATE_SENTINEL', kind: 'counter' }; requestLabels[0] = 'r1';
  const chunk = Buffer.concat([line(declaration()), line(sample())]);
  const pending = stream.push(chunk, signal()); chunk.fill(0);
  await pending; expect(points).toHaveLength(1); stream.finish();
});

it('copies actual typed-array bytes without invoking overridable iteration or length hooks', async () => {
  const bytes = Buffer.concat([line(declaration()), line(sample())]);
  const input = Uint8Array.from(bytes);
  const iterator = vi.fn(function* () { yield* new Uint8Array(2_000_000); });
  Object.defineProperty(input, Symbol.iterator, { value: iterator });
  Object.defineProperty(input, 'byteLength', { get: () => { throw new Error('PRIVATE_SENTINEL'); } });
  const { stream, points } = setup();
  await stream.push(input, signal());
  expect(iterator).not.toHaveBeenCalled(); expect(points).toHaveLength(1); stream.finish();
  const oversized = Uint8Array.from(bytes);
  Object.defineProperty(oversized, 'byteLength', { value: 1 });
  await expect(setup({ maximumBytes: 1 }).stream.push(oversized, signal())).rejects.toMatchObject({ code: 'stream_limit' });
});
it('rejects impossible calendar/time/offset dates instead of normalizing them', async () => {
  for (const time of ['2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z', '2026-04-31T12:00:00Z',
    '2026-01-00T12:00:00Z', '2026-13-01T12:00:00Z', '2026-11-07T24:00:00Z', '2026-11-07T12:60:00Z',
    '2026-11-07T12:00:60Z', '2026-11-07T12:00:00+24:00', '2026-11-07T12:00:00+01:60']) {
    const { stream, point } = setup(); const value = sample(); value.data.time = time;
    await expect(stream.push(Buffer.concat([line(declaration()), line(value)]), signal())).rejects.toMatchObject({ code: 'invalid_record' });
    expect(point).not.toHaveBeenCalled();
  }
  for (const time of ['2024-02-29T12:00:00.123456789Z', '2026-11-07T12:00:00.1+05:30']) {
    const { stream, points } = setup(); const value = sample(); value.data.time = time;
    await stream.push(Buffer.concat([line(declaration()), line(value)]), signal()); expect(points).toHaveLength(1); stream.finish();
  }
});
