import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {afterEach, beforeEach, expect, it} from 'vitest';
import {decodeK6Diagnostics} from '@beetle/contracts/k6-diagnostics';
import {reserveOutput} from '../../wrapper/attempt/reservation.js';
import {fixture, native, resetNative} from './fixtures.js';
const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative); afterEach(async () => {await Promise.all(cleanups.splice(0).map(clean => clean()));});
it('reserves diagnostics inside the unchanged minimum and leaves useful numeric capacity', () => {
  const minimum = 3044252; expect(() => reserveOutput(minimum - 1)).toThrow('output_limit');
  const r = reserveOutput(minimum); expect(r.diagnostics).toBe(32768); expect(r.numeric).toBe(1011712);
  expect(r.numeric + r.warnings + r.diagnostics).toBe(1048576);
  expect(r.control + r.numeric + r.warnings + r.diagnostics + r.result + r.execution + r.reports).toBe(minimum);
});
it('seals safe diagnostic history using exact custody, hash and ordinary descriptor publication', async () => {
  const f = await fixture(); cleanups.push(f.cleanup); native.diagnostics = true; native.warnings = true;
  const result = await f.run(); expect(result.ok).toBe(true);
  const artifact = result.result!.artifacts.find(value => value.kind === 'k6-diagnostics')!; expect(artifact).toBeDefined();
  const bytes = await readFile(join(f.outputRoot, artifact.relativePath));
  expect(bytes.length).toBe(artifact.bytes); expect(bytes.length).toBeLessThanOrEqual(32768);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
  const report = decodeK6Diagnostics(bytes); expect(report.scope.attemptId).toBe(f.offer.attemptId);
  expect(report.records).toEqual([{sequence: 1, level: 'error', code: 'redacted'}]);
  expect(result.result!.artifacts.length).toBe(8);
});
it('does not manufacture a complete empty artifact when the process had no diagnostic evidence', async () => {
  const f = await fixture(); cleanups.push(f.cleanup); const result = await f.run();
  expect(result.ok).toBe(true); expect(result.result!.artifacts.some(value => value.kind === 'k6-diagnostics')).toBe(false);
});
