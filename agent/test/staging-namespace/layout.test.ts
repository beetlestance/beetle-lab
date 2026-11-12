import { expect, it } from 'vitest';
import { lstat, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeCanonicalJson, RUNNER_MAXIMUM_CONFIG_BYTES } from '@beetle/contracts';
import { captureNativeCleanupPlan, cleanupControl } from '../../src/cleanup-control/index.js';
import type { CleanupEntry } from '../../src/cleanup-control/index.js';
import { scope } from '../admission/fixtures.js';
import { fixture, hash, stream } from '../staging/fixtures.js';
const f = fixture();
const outputFiles = ['beetle-evidence.json', 'control.ndjson', 'engine-result.json', 'metric-index.ndjson',
  'metric-windows.ndjson', 'metrics.csv', 'numeric-final.json', 'performance-report.txt', 'suite.js'];
async function inventory(root: string, path = ''): Promise<CleanupEntry[]> {
  const absolute = join(root, path); const stat = await lstat(absolute, { bigint: true });
  const native = { dev: stat.dev.toString(), ino: stat.ino.toString(), uid: stat.uid.toString(), gid: stat.gid.toString(), mode: stat.mode.toString() };
  if (stat.isFile()) return [{ path, kind: 'file', native: { ...native, bytes: stat.size.toString(), links: '1' } }];
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unexpected native fixture entry');
  const rows: CleanupEntry[] = [{ path, kind: 'directory', native }];
  const children = await readdir(absolute); expect(children.length).toBeLessThanOrEqual(131);
  for (const child of children.toSorted()) rows.push(...await inventory(root, path ? path + '/' + child : child));
  return rows;
}
it('fits actual128-input/64 maximum-name secret layout and maximum config in the frozen control plan', async () => {
  const e = await f.environment(false, 30_000); const empty = Buffer.alloc(0);
  e.offer.inputs = Array.from({ length: 128 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(1000 + n).padStart(12, '0')}`, bytes: 0, sha256: hash(empty) }));
  e.offer.secretReferences = Array.from({ length: 64 }, (_, n) => ({ name: 'S'.repeat(125) + String(n).padStart(3, '0'), provider: 'mounted', reference: 'opaque' + n }));
  e.offer.config.padding = '';
  e.offer.config.padding = 'x'.repeat(RUNNER_MAXIMUM_CONFIG_BYTES - Buffer.byteLength(JSON.stringify(e.offer.config)));
  expect(Buffer.byteLength(JSON.stringify(e.offer.config))).toBe(RUNNER_MAXIMUM_CONFIG_BYTES);
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  let providers = 0;
  const stager = e.create({ providers: { input: async () => {
    if (++providers === 1) expect((await e.owner.stagingNamespace.readTask({ ...scope(e.offer), generation: 1 }))?.state).toBe('prepared');
    return stream(empty);
  }, secret: async () => Buffer.alloc(16384, 'z') } });
  const operation = e.prepare(stager, e.offer, 30_000); const result = await operation.result; await operation.quiesced;
  if (!result.ok) throw new Error('Maximum layout preparation failed: ' + result.reason); expect(providers).toBe(128);
  const root = join(e.rootPath, result.value.name);
  // Supported output names include control/result/script internals as well as published artifacts.
  for (const name of outputFiles) await writeFile(join(root, 'output', name), '', { mode: 0o600 });
  const rows = (await inventory(root)).toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const installed = await e.owner.stagingNamespace.read(); const task = await e.owner.stagingNamespace.readTask({ ...scope(e.offer), generation: 1 });
  if (installed?.state !== 'bound' || task?.state !== 'prepared') throw new Error('Missing actual native anchors');
  const plan = captureNativeCleanupPlan({ protocolVersion: 1, purpose: 'performance', original: { ...scope(e.offer), intentDigest: e.offer.intentDigest },
    namespaceIdentity: installed.anchor.namespaceIdentity, taskNamespaceIdentity: task.anchor.taskNamespaceIdentity,
    retirementRequestDigest: 'd'.repeat(64), retirementVersion: 1, entries: rows });
  const planBytes = Buffer.byteLength(encodeCanonicalJson(plan, cleanupControl.planBytes));
  expect(plan.entries.length).toBe(208); expect(planBytes).toBeLessThanOrEqual(cleanupControl.planBytes);
  expect(await readdir(join(root, 'input'))).toHaveLength(131); expect(await readdir(join(root, 'secrets'))).toHaveLength(64);
  const measurement = { maxLayoutEntries: plan.entries.length, planBytes, planLimit: cleanupControl.planBytes };
  const evidence = process.env.BEETLE_C1_LAYOUT_EVIDENCE;
  if (evidence) await writeFile(evidence, JSON.stringify(measurement) + '\n');
}, 30_000);
