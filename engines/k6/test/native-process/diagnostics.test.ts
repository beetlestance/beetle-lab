import {flush, harness} from './fixtures.js';
import {expect, it} from 'vitest';
import {WarningClassifier} from '../../wrapper/process/warnings.js';
const line = (msg: string, level = 'error') => Buffer.from(JSON.stringify({msg, level, secret: 'HIDDEN_FIELD'}) + '\n');
it('shares the bounded parser, preserves order/severity and never carries dynamic native values', () => {
  const parser = new WarningClassifier(); const bytes = Buffer.concat([line('https://secret/ TOKEN', 'info'), line('Insufficient VUs, SECRET', 'warning'), line('private failure')]);
  for (const byte of bytes) parser.push(Uint8Array.of(byte)); parser.finish();
  const report = parser.history.snapshot(); expect(report.coverage).toBe('complete');
  expect(report.observedBytes).toBe(bytes.length); expect(report.observedRecords).toBe(3); expect(report.redactedRecords).toBe(2);
  expect(report.records.map(record => [record.sequence, record.level, record.code])).toEqual([[1, 'info', 'redacted'], [2, 'warning', 'insufficient-vus'], [3, 'error', 'redacted']]);
  expect(JSON.stringify(report)).not.toMatch(/TOKEN|SECRET|secret|private|HIDDEN|https/);
});
it('retains only a fixed prefix while counting overflow and keeps draining', () => {
  const parser = new WarningClassifier(); for (let i = 0; i < 300; i++) parser.push(line('SECRET'));
  parser.finish(); const report = parser.history.snapshot();
  expect(report.records).toHaveLength(256); expect(report.droppedRecords).toBe(44); expect(report.observedRecords).toBe(300);
  expect(report.redactedRecords).toBe(300); expect(report.coverage).toBe('partial');
});
it('distinguishes redaction from malformed, oversized, invalid UTF8, unterminated and interrupted capture', () => {
  const parser = new WarningClassifier(); parser.push(Buffer.from('not json\n')); parser.push(Uint8Array.of(255, 10));
  parser.push(line('x'.repeat(5000))); parser.push(line('SECRET').subarray(0, -1)); parser.finish();
  expect(parser.history.snapshot()).toMatchObject({coverage: 'partial', invalidSegments: 4, redactedRecords: 0});
  const stopped = new WarningClassifier(); stopped.push(line('SECRET')); stopped.interrupt(); stopped.finish();
  expect(stopped.history.snapshot()).toMatchObject({coverage: 'partial', redactedRecords: 1});
  const empty = new WarningClassifier(); expect(empty.history.snapshot().coverage).toBe('partial'); empty.finish();
  expect(empty.history.snapshot()).toMatchObject({coverage: 'complete', observedRecords: 0});
});

it('exports safe diagnostics from the actual process observer only after stderr drains', async () => {
  const h = harness(); const running = h.actor.run(); await flush(); h.child.start();
  const bytes = line('SECRET_URL', 'error'); h.child.stderr.end(bytes); h.child.stdout.end();
  await new Promise<void>(resolve => setImmediate(resolve)); h.absent(); h.child.end(); h.child.finish();
  const observed = await running; await h.actor.close();
  expect(observed.diagnostics).toMatchObject({coverage: 'complete', observedBytes: bytes.length, redactedRecords: 1});
  expect(JSON.stringify(observed)).not.toContain('SECRET'); expect(observed.stdioClosed).toBe(true);
});
