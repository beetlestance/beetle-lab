import { chmod, link, mkdir, readFile, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createControlWriter, replayControl } from '../../wrapper/control/index.js';
import type { ControlDraft } from '../../wrapper/control/index.js';
import { budget, corpus, directory, draft, options, scope } from './fixtures.js';

test('fresh writer is exclusive, 0600 and assigns immutable contiguous events', async () => {
  const path = await directory(); const writer = await createControlWriter(options(path), budget());
  await expect(createControlWriter(options(path), budget())).rejects.toMatchObject({ code: 'already_exists' });
  const input = draft(); const event = await writer.append(input, budget());
  expect(event.seq).toBe(1); expect(Object.isFrozen(event.payload)).toBe(true);
  expect((await writer.append(input, budget())).seq).toBe(2);
  await writer.close(); await writer.close();
  expect((await stat(join(path, 'control.ndjson'))).mode & 0o777).toBe(0o600);
  expect((await replayControl({ ...options(path), after: 0 }, budget())).events).toHaveLength(2);
  await expect(writer.append(input, budget())).rejects.toMatchObject({ code: 'closed' });
});

test.each([
  { ...draft(), seq: 7 }, { ...draft(), kind: 'runtime.exited' },
  { ...draft(), generation: 2 }, { ...draft(), attemptId: scope.workspaceId },
  { ...draft(), workspaceId: scope.organizationId }, { ...draft(), organizationId: scope.attemptId },
  { ...draft(), payload: { completedUnits: -1 } },
])('rejects invalid/source/scoped drafts before any write', async invalid => {
  const path = await directory(); const writer = await createControlWriter(options(path), budget());
  await expect(writer.append(invalid as ControlDraft, budget())).rejects.toBeDefined();
  expect((await stat(join(path, 'control.ndjson'))).size).toBe(0);
  expect((await writer.append(draft(), budget())).seq).toBe(1); await writer.close();
});

test('quota charges exact UTF8 bytes including LF and rejects before writing', async () => {
  const path = await directory(); const writer = await createControlWriter(options(path, { quotaBytes: 1024 }), budget());
  const unicode = { ...draft(), kind: 'case.result', payload: { caseKey: '💡'.repeat(120),
    outcome: 'passed', durationMs: 1, required: true, artifactIds: [] } } as ControlDraft;
  const event = await writer.append(unicode, budget());
  const bytes = Buffer.byteLength(JSON.stringify(event) + '\n');
  expect((await stat(join(path, 'control.ndjson'))).size).toBe(bytes);
  await expect(writer.append(unicode, budget())).rejects.toMatchObject({ code: 'quota_limit' });
  expect((await stat(join(path, 'control.ndjson'))).size).toBe(bytes); await writer.close();
});

test('bounded encoder refuses huge/cyclic/accessor input without effects or getters', async () => {
  const path = await directory(); const writer = await createControlWriter(options(path), budget());
  let calls = 0;
  const accessor = { ...draft(), get extra() { calls++; return 'secret'; } };
  const cyclic: Record<string, unknown> = { ...draft() }; cyclic.self = cyclic;
  for (const invalid of [{ ...draft(), extra: '💡'.repeat(65_536) }, cyclic, accessor]) {
    await expect(writer.append(invalid as ControlDraft, budget())).rejects.toMatchObject({ code: 'frame_limit' });
  }
  expect(calls).toBe(0); expect((await stat(join(path, 'control.ndjson'))).size).toBe(0);
  await writer.close();
});

test('captures immutable authority before awaits and validates scope before filesystem access', async () => {
  const path = await directory(); const mutableScope = { ...scope };
  const pending = createControlWriter(options(path, { scope: mutableScope }), budget()); mutableScope.generation = 2;
  const writer = await pending; expect((await writer.append(draft(), budget())).generation).toBe(1); await writer.close();
  await expect(createControlWriter(options(path, { scope: { ...scope, attemptId: 'bad' } }), budget()))
    .rejects.toMatchObject({ code: 'invalid_options' });
});

test('refuses existing symlink, hardlink, nonregular and ordinary files without mutation', async () => {
  const source = await directory(); await corpus(source, 'retained');
  for (const kind of ['symlink', 'hardlink', 'directory', 'file']) {
    const path = await directory(); const target = join(path, 'control.ndjson');
    if (kind === 'symlink') await symlink(join(source, 'control.ndjson'), target);
    if (kind === 'hardlink') await link(join(source, 'control.ndjson'), target);
    if (kind === 'directory') await mkdir(target);
    if (kind === 'file') await corpus(path, 'retained');
    await expect(createControlWriter(options(path), budget())).rejects.toMatchObject({ code: 'already_exists' });
  }
  expect(await readFile(join(source, 'control.ndjson'), 'utf8')).toBe('retained');
});

test('checks trusted directory and limits before creating evidence', async () => {
  const path = await directory(); const target = await directory(); const alias = join(path, 'alias'); await symlink(target, alias);
  for (const directory of [alias, '.', path + '/.']) {
    await expect(createControlWriter(options(directory), budget())).rejects.toMatchObject({ code: 'untrusted_directory' });
  }
  await chmod(path, 0o777);
  await expect(createControlWriter(options(path), budget())).rejects.toMatchObject({ code: 'untrusted_directory' });
  await chmod(path, 0o700);
  for (const quotaBytes of [0, 1023, 67_108_865, NaN]) {
    await expect(createControlWriter(options(path, { quotaBytes }), budget())).rejects.toMatchObject({ code: 'invalid_options' });
  }
});
