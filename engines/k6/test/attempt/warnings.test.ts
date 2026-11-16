import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { decodeK6Warnings } from '@beetle/contracts/k6-warnings';
import { reserveOutput } from '../../wrapper/attempt/reservation.js';
import { fixture, native, resetNative } from './fixtures.js';
const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative); afterEach(async () => {await Promise.all(cleanups.splice(0).map(clean => clean()));});
it('pre-reserves warning bytes without increasing the existing minimum/build/history budget', () => {
  const minimum = 3044252; expect(() => reserveOutput(minimum - 1)).toThrow('output_limit');
  const r = reserveOutput(minimum); expect(r.warnings).toBe(4096); expect(r.numeric + r.warnings + r.diagnostics).toBe(1048576);
  expect(r.control + r.numeric + r.warnings + r.diagnostics + r.result + r.execution + r.reports).toBe(minimum);
  expect(r.history).toBe(65536); expect(r.result).toBe(65536);
});
it('seals warning evidence under the admitted descriptor/result limits and exact hash', async () => {
  const f = await fixture(); cleanups.push(f.cleanup); native.warnings = true;
  const result = await f.run(); expect(result.ok).toBe(true);
  const artifacts = result.result!.artifacts; const a = artifacts.find(value => value.kind === 'k6-warnings')!;
  expect(a).toBeDefined(); expect(artifacts.length).toBe(7); expect(artifacts.length).toBeLessThanOrEqual(128);
  expect(Buffer.byteLength(JSON.stringify(result.result))).toBeLessThan(65536);
  expect(Buffer.byteLength(JSON.stringify(artifacts))).toBeLessThan(65536);
  const bytes = await readFile(join(f.outputRoot, a.relativePath)); expect(bytes.length).toBe(a.bytes); expect(a.bytes).toBeLessThanOrEqual(4096);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256);
  const report = decodeK6Warnings(bytes); expect(report.native.insufficientVus).toBe(1); expect(report.iteration).toBeNull();
  expect(report.scope).toMatchObject({organizationId: f.offer.organizationId, workspaceId: f.offer.workspaceId, attemptId: f.offer.attemptId, generation: 1});
});
