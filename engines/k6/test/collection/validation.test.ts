import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readK6Summary } from '../../wrapper/collection/index.js';
import { metricEvidenceLayout } from '../../plan/index.js';
import { encodeJson } from '../../../../contracts/src/index.js';
import { fixture } from './fixtures.js';

describe('native projection collection', () => {
  it('roundtrips actual producer and public JSON encoder with unknown evidence preserved', async () => {
    const f = await fixture();
    try {
      await writeFile(f.path, encodeJson(f.json, 1_048_576));
      const operation = readK6Summary(f.options); const result = await operation.result;
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.evidence.nativeCollection).toBe('partial');
      expect(result.evidence.metrics.vus!.values).toEqual({});
      expect(result.evidence.metrics.vus!.missingStats).toContain('value');
      const rules = metricEvidenceLayout(f.options.compiledSuite);
      for (const entry of rules.metrics) {
        expect(result.evidence.metrics[entry.key]!.thresholds.map(rule => rule.expression)).toEqual(entry.thresholds.map(rule => rule.threshold));
      }
      expect(result.evidence.metrics.beetle_required_failures!.thresholds).toEqual([
        { expression: 'count>=0', ok: null }, { expression: 'count==0', ok: true }]);
      expect(Object.isFrozen(result.evidence.metrics.vus!.values)).toBe(true);
      expect(result.evidence.sha256).toBe(createHash('sha256').update(encodeJson(f.json, 1_048_576)).digest('hex'));
      await operation.quiesced; await operation.close();
    } finally { await f.dispose(); }
  });
  it.each(['missing', 'extra', 'root', 'permetric', 'valuekey', 'negative', 'integer', 'rate', 'order', 'threshold', 'null', 'duplicate'])('%s rejects closed shape or contradictory numbers', async kind => {
    const f = await fixture();
    try {
      const metric = f.json.metrics.http_req_duration!;
      const mutateShape = () => {
      if (kind === 'missing') delete f.json.metrics.vus;
      if (kind === 'extra') f.json.metrics.secret = metric;
      if (kind === 'root') Object.assign(f.json, { secret: 'canary' });
      if (kind === 'permetric') Object.assign(metric, { secret: 'canary' });
      if (kind === 'valuekey') metric.values.secret = 1;
      }; mutateShape();
      if (kind === 'negative') metric.values.avg = -1;
      if (kind === 'integer') metric.values.count = 1.5;
      if (kind === 'rate') f.json.metrics.http_req_failed!.values.rate = 2;
      if (kind === 'order') metric.values.min = 6;
      if (kind === 'threshold') f.json.metrics.beetle_required_failures!.thresholds.reverse();
      if (kind === 'null') metric.values.avg = null;
      const raw = kind === 'duplicate' ? f.raw.replace('"version":2', '"version":2,"version":2') : JSON.stringify(f.json);
      await writeFile(f.path, raw);
      const operation = readK6Summary(f.options);
      expect(await operation.result).toMatchObject({ ok: false, code: 'invalid' }); await operation.quiesced;
    } finally { await f.dispose(); }
  });
  it.each(['utf8', 'depth', 'collection', 'nodes', 'oversize', 'nonfinite'])('bounds %s before semantic iteration', async kind => {
    const f = await fixture();
    try {
      const inputs: Record<string, string | Uint8Array> = { utf8: new Uint8Array([255]), depth: '['.repeat(66) + '0' + ']'.repeat(66),
        collection: JSON.stringify(Array(4097).fill(0)), nodes: JSON.stringify(Array.from({ length: 17 }, () => Array(4096).fill(0))),
        oversize: ' '.repeat(1_048_577), nonfinite: f.raw.replace('"avg":3', '"avg":1e999') };
      await writeFile(f.path, inputs[kind]!);
      const operation = readK6Summary(f.options); expect(await operation.result).toMatchObject({ ok: false }); await operation.quiesced;
    } finally { await f.dispose(); }
  });
  it('accepts appropriate numeric stats and rejects contradictory median aliases', async () => {
    const f = await fixture();
    try {
      f.json.metrics.http_req_duration!.values = { count: 2, avg: 3, min: 1, max: 5, med: 3,
        'p(50)': 3, 'p(90)': 4, 'p(95)': 4.5, 'p(99)': 5 };
      f.json.metrics.http_req_failed!.values = { rate: 0.5, passes: 1, fails: 1 };
      f.json.metrics.vus!.values = { value: 2, min: 1, max: 3 };
      f.json.metrics.beetle_requests!.values = { count: 2, rate: 200 };
      await writeFile(f.path, JSON.stringify(f.json));
      let op = readK6Summary(f.options); expect(await op.result).toMatchObject({ ok: true }); await op.quiesced;
      f.json.metrics.http_req_duration!.values.med = 3.5;
      await writeFile(f.path, JSON.stringify(f.json));
      op = readK6Summary(f.options); expect(await op.result).toMatchObject({ ok: false, code: 'invalid' }); await op.quiesced;
    } finally { await f.dispose(); }
  });
});
