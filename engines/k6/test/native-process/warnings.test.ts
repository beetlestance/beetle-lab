import { expect, it } from 'vitest';
import { WarningClassifier } from '../../wrapper/process/warnings.js';
const record = (msg: string, level = 'warning') => Buffer.from(JSON.stringify({level, msg}) + '\n');
it('classifies split JSON logs without persisting native canaries', () => {
  const parser = new WarningClassifier(); const bytes = record('Insufficient VUs, reached 1 SECRET_URL');
  for (const byte of bytes) parser.push(Uint8Array.of(byte));
  parser.push(record('Too many time series: high cardinality'));
  parser.push(record('maxDuration reached'));
  parser.push(record('SECRET_URL', 'info')); parser.finish();
  expect(parser.snapshot()).toEqual({coverage: 'complete', insufficientVus: 1, highCardinality: 1, maxDuration: 1, otherWarnings: 0, discardedSegments: 0});
  expect(JSON.stringify(parser.snapshot())).not.toContain('SECRET');
});
it('unknown, malformed and invalid UTF8 sources stay partial', () => {
  const parser = new WarningClassifier(); parser.push(record('SECRET unknown'));
  parser.push(Buffer.from('not json\n')); parser.push(Uint8Array.of(255, 10)); parser.finish();
  expect(parser.snapshot()).toMatchObject({coverage: 'partial', otherWarnings: 1, discardedSegments: 2});
});
it('never classifies oversized prefixes and resynchronizes at a later complete line', () => {
  const parser = new WarningClassifier(); parser.push(record('Insufficient VUs,' + 'x'.repeat(5000)));
  parser.push(Buffer.alloc(65537, 120)); parser.push(record('Insufficient VUs, skipped tail'));
  parser.push(record('Insufficient VUs, valid')); parser.finish();
  expect(parser.snapshot()).toMatchObject({coverage: 'partial', insufficientVus: 1, discardedSegments: 2});
});
it('interruption is sticky while normal EOF is idempotent', () => {
  const parser = new WarningClassifier(); parser.push(record('Insufficient VUs,')); parser.interrupt(); parser.finish();
  parser.push(record('Insufficient VUs,')); expect(parser.snapshot()).toMatchObject({coverage: 'partial', insufficientVus: 1});
  const complete = new WarningClassifier(); complete.finish(); complete.interrupt(); expect(complete.snapshot().coverage).toBe('complete');
});
it('a valid-looking unterminated record is partial and never counted', () => {
  const parser = new WarningClassifier(); parser.push(record('Insufficient VUs,').subarray(0, -1)); parser.finish();
  expect(parser.snapshot()).toMatchObject({coverage: 'partial', insufficientVus: 0, discardedSegments: 1});
});
