import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sealEngineResult, verifyEngineResultSeal } from '@beetle/contracts';
import { createControlWriter, replayControl } from '../../wrapper/control/index.js';
import { mapK6Result } from '../../wrapper/result/index.js';
import type { K6ResultInput } from '../../wrapper/result/index.js';
import { publishK6Result } from '../../wrapper/publication/index.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Owned compatibility fixture only; journal replay is not application finalization. */
export async function recordResult(input: { evidence: K6ResultInput; directory: string;
  deadlineMs: number; signal: AbortSignal; expected: 'passed' | 'failed' }) {
  const mapped = mapK6Result(input.evidence);
  assert(mapped.ok, JSON.stringify(mapped));
  assert.equal(mapped.body.outcome, input.expected);
  assert.equal(mapped.body.completeness, 'complete');
  assert.equal(mapped.body.execution.status, 'completed');
  assert.equal(mapped.body.execution.exitCode, input.expected === 'passed' ? 0 : 99);
  assert.deepEqual(mapped.body.requiredAssertions, { required: 1, passed: input.expected === 'passed' ? 1 : 0,
    failed: input.expected === 'failed' ? 1 : 0, unknown: 0 });
  const sealed = sealEngineResult(mapped.body, new Date().toISOString(), sha256);
  assert(sealed.ok, JSON.stringify(sealed));
  const publishing = publishK6Result({ result: sealed.value, expectedScope: input.evidence.scope, directory: input.directory,
    uid: process.getuid!(), maximumBytes: 65_536, deadlineMs: input.deadlineMs, timeoutMs: 2000, signal: input.signal });
  const published = await publishing.result;
  await publishing.quiesced; await publishing.close(); assert(published.ok, JSON.stringify(published));
  assert(published.bytes <= 65_536);
  const bytes = await readFile(join(input.directory, published.relativePath));
  assert.equal(bytes.byteLength, published.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), published.rawSha256);
  const disk = verifyEngineResultSeal(JSON.parse(bytes.toString('utf8')) as unknown, sha256);
  assert(disk.ok, JSON.stringify(disk)); assert.deepEqual(disk.value, sealed.value);
  const budget = () => ({ deadline: performance.now() + Math.min(2000, input.deadlineMs - Date.now()), signal: input.signal });
  const options = { directory: input.directory, scope: input.evidence.scope, quotaBytes: 65_536 };
  const writer = await createControlWriter(options, budget());
  try {
    await writer.append({ version: '1.0', ...input.evidence.scope, kind: 'engine.result', phase: 'seal',
      observedAt: new Date().toISOString(), payload: disk.value }, budget());
  } finally { await writer.close(); }
  const replay = await replayControl({ ...options, after: 0 }, budget());
  assert.equal(replay.state, 'complete'); assert.equal(replay.nextCursor, 1); assert.equal(replay.hasMore, false);
  const event = replay.events[0]; assert(event?.kind === 'engine.result');
  const verified = verifyEngineResultSeal(event.payload, sha256);
  assert(verified.ok, JSON.stringify(verified));
  assert.deepEqual(verified.value, sealed.value);
  return { outcome: verified.value.outcome, requiredAssertions: verified.value.requiredAssertions,
    resultBytes: published.bytes, journalBytes: replay.snapshotBytes, sealVerified: true };
}
