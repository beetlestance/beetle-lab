import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach } from 'vitest';
import { nodeJournalIo } from '../../wrapper/control/index.js';
import type { ControlDraft, JournalFile, JournalIo, JournalScope } from '../../wrapper/control/index.js';

export const scope: JournalScope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  attemptId: '33333333-3333-4333-8333-333333333333', generation: 1,
};
export function budget(milliseconds = 5000) { return { deadline: performance.now() + milliseconds }; }
export function draft(): ControlDraft {
  return { ...scope, version: '1.0', phase: 'execute', observedAt: '2026-01-01T00:00:00Z',
    kind: 'progress', payload: { completedUnits: 1, totalUnits: 2, heartbeat: true, usefulProgress: true } };
}
export function line(seq = 1): string { return JSON.stringify({ ...draft(), seq }) + '\n'; }
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
export async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'w09-control-'));
  const resolved = await nodeJournalIo.realpath(path); directories.push(resolved); return resolved;
}
export function options(path: string, extra = {}) { return { directory: path, scope, quotaBytes: 67_108_864, ...extra }; }
export async function corpus(path: string, data: string | Buffer): Promise<void> {
  await writeFile(join(path, 'control.ndjson'), data, { mode: 0o600 });
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
export function adapter(wrap: (file: JournalFile, path: string) => JournalFile): JournalIo {
  return { ...nodeJournalIo, async open(path, flags, mode) {
    return wrap(await nodeJournalIo.open(path, flags, mode), path);
  } };
}
export function fileWith(file: JournalFile, overrides: Partial<JournalFile>): JournalFile {
  return { stat: () => file.stat(), sync: () => file.sync(), close: () => file.close(),
    read: (...args) => file.read(...args), write: (...args) => file.write(...args), ...overrides };
}
