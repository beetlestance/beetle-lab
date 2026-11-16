import { execFile } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { validate } from '@beetle/contracts';
import { createControlWriter, replayControl } from '../../wrapper/control/index.js';
import type { ControlDraft } from '../../wrapper/control/index.js';
import { adapter, budget, directory, draft, fileWith, line, options, scope } from './fixtures.js';

function largeDraft(): ControlDraft {
  const payload = { protocolVersion: '1.0', ...scope,
    schemaId: 'https://beetle-lab.dev/contracts/runner/v1/engine-result', engineId: 'k6',
    requiredAssertions: { required: 0, passed: 0, failed: 0, unknown: 0 },
    thresholds: [], completeness: 'complete', artifacts: Array.from({ length: 100 }, () => ({
      artifactId: scope.attemptId, kind: 'output', relativePath: 'a'.repeat(400), bytes: 0,
      sha256: 'a'.repeat(64), sealedAt: '2026-01-01T00:00:00Z',
    })), seal: { sha256: 'a'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' },
    outcome: 'passed', execution: { status: 'completed', exitCode: 0, stoppedAt: '2026-01-01T00:00:00Z' }, mode: 'ordinary',
  };
  return { ...draft(), kind: 'engine.result', payload } as ControlDraft;
}

test('exact 64 KiB frame includes LF and rejects one extra byte before writing', async () => {
  const path = await directory(); let writes = 0;
  const io = adapter(file => fileWith(file, { async write(...args) { writes++; return file.write(...args); } }));
  const input = largeDraft();
  if (input.kind !== 'engine.result') throw new Error('fixture');
  const artifacts = input.payload.artifacts;
  const initial = Buffer.byteLength(JSON.stringify({ ...input, seq: 1 }) + '\n');
  const extra = 65_536 - initial;
  expect(extra).toBeGreaterThan(0);
  let remaining = extra;
  for (const artifact of artifacts) {
    const count = Math.min(512 - artifact.relativePath.length, remaining);
    artifact.relativePath += 'a'.repeat(count); remaining -= count;
  }
  expect(remaining).toBe(0);
  expect(validate('ControlEvent', { ...input, seq: 1 }).ok).toBe(true);
  expect(Buffer.byteLength(JSON.stringify({ ...input, seq: 1 }) + '\n')).toBe(65_536);
  const writer = await createControlWriter(options(path, { io }), budget());
  const first = artifacts.find(artifact => artifact.relativePath.length < 512);
  if (!first) throw new Error('fixture');
  first.relativePath += 'a';
  await expect(writer.append(input, budget())).rejects.toMatchObject({ code: 'frame_limit' }); expect(writes).toBe(0);
  first.relativePath = first.relativePath.slice(0, -1);
  await writer.append(input, budget()); expect(writes).toBe(1); await writer.close();
});

test('configured exact byte quota includes Unicode and LF', async () => {
  const path = await directory();
  const input = { ...draft(), kind: 'case.result', payload: { caseKey: '💡'.repeat(256),
    outcome: 'passed', durationMs: 1, required: true, artifactIds: [] } } as ControlDraft;
  const bytes = Buffer.byteLength(JSON.stringify({ ...input, seq: 1 }) + '\n');
  expect(bytes).toBeGreaterThan(1024);
  const writer = await createControlWriter(options(path, { quotaBytes: bytes }), budget());
  await writer.append(input, budget());
  await expect(writer.append(input, budget())).rejects.toMatchObject({ code: 'quota_limit' });
  await writer.close(); expect((await readFile(join(path, 'control.ndjson'))).length).toBe(bytes);
});

test('nested engine result cannot carry another generation or scope', async () => {
  const path = await directory(); const writer = await createControlWriter(options(path), budget());
  const input = largeDraft();
  if (input.kind !== 'engine.result') throw new Error('fixture');
  input.payload.generation = 2;
  await expect(writer.append(input, budget())).rejects.toMatchObject({ code: 'scope_mismatch' });
  input.payload.generation = 1; input.payload.organizationId = scope.workspaceId;
  await expect(writer.append(input, budget())).rejects.toMatchObject({ code: 'scope_mismatch' });
  await writer.close(); expect((await readFile(join(path, 'control.ndjson'))).length).toBe(0);
});

test('65536 record cap is checked across the whole bounded source', async () => {
  const path = await directory(); const file = await open(join(path, 'control.ndjson'), 'wx', 0o600);
  try {
    for (let start = 1; start <= 65_537; start += 256) {
      const size = Math.min(256, 65_538 - start);
      await file.write(Array.from({ length: size }, (_, index) => line(start + index)).join(''));
    }
  } finally { await file.close(); }
  await expect(replayControl({ ...options(path), after: 0 }, budget())).rejects.toMatchObject({ code: 'corruption' });
});

test('abrupt synthetic Node exit retains durable prefix for read-only replay', async () => {
  const path = await directory(); const source = new URL('../../wrapper/control/index.ts', import.meta.url).href;
  const script = `
    import { createControlWriter } from ${JSON.stringify(source)};
    const writer = await createControlWriter(${JSON.stringify(options(path))}, {deadline:performance.now()+5000});
    await writer.append(${JSON.stringify(draft())}, {deadline:performance.now()+5000});
    process.exit(23);
  `;
  await expect(promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script],
    { timeout: 5000, maxBuffer: 4096 })).rejects.toMatchObject({ code: 23 });
  expect(await replayControl({ ...options(path), after: 0 }, budget())).toMatchObject({ nextCursor: 1, state: 'complete' });
  await expect(createControlWriter(options(path), budget())).rejects.toMatchObject({ code: 'already_exists' });
});
