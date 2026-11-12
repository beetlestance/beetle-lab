import { afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sealEngineResult } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { Manager } from '../../src/installation/manager.js';
import type { Entry } from '../../src/installation/entry.js';
import type { Journal } from '../../src/journal/index.js';
import { Supervisor } from '../../src/supervisor/index.js';
import type { fixture } from './fixtures.js';
export { deferred } from '../supervisor/fixtures.js';

export function entries(manager: Manager): Map<string, Entry> { return Reflect.get(manager, 'entries') as Map<string, Entry>; }
export function managers() {
  const owned: Manager[] = [];
  afterEach(async () => { await Promise.allSettled(owned.splice(0).map(manager => manager.close())); });
  return (options: ConstructorParameters<typeof Manager>[0]) => { const manager = new Manager(options); owned.push(manager); return manager; };
}
export function trapped(journal: Journal) {
  const trap = vi.fn((): never => { throw new Error('unexpected producer/catalogue/staging work'); });
  const supervisor = new Supervisor({ journal, backendFactory: trap, installationId: '00000000-0000-4000-8000-000000000010' });
  vi.spyOn(supervisor, 'actor').mockImplementation(trap); vi.spyOn(supervisor, 'retire').mockImplementation(trap);
  return { journal, supervisor, catalog: { engines: [], preflightExport: trap, preflight: trap, resolve: trap }, stagerFor: trap,
    guard: { watch: trap }, timeout: { watch: trap }, trap, wallNow: () => 100_010 };
}
/** Real files and seals; synthetic backend observations do not qualify native execution. */
export async function writeResult(e: Awaited<ReturnType<ReturnType<typeof fixture>['setup']>>, manager: Manager): Promise<void> {
  const entry = [...entries(manager).values()][0]!; if (!entry.plan) throw new Error('Missing actual staged plan');
  const original = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  const { seal, ...body } = original; void seal;
  const result = sealEngineResult({ ...body, ...entry.key, engineId: e.offer.engine.id, artifacts: [] },
    '2026-01-01T00:00:00Z', text => createHash('sha256').update(text).digest('hex'));
  if (!result.ok) throw new Error(result.code);
  const root = join(e.engine.profile.stagingRoot, entry.plan.name, 'output');
  const event = { version: '1.0', ...entry.key, seq: 1, phase: 'seal', kind: 'engine.result',
    observedAt: '2026-01-01T00:00:00Z', payload: result.value };
  await writeFile(join(root, 'engine-result.json'), JSON.stringify(result.value), { mode: 0o600 });
  await writeFile(join(root, 'control.ndjson'), JSON.stringify(event) + '\n', { mode: 0o600 });
}
export function withheld(journal: Journal) {
  const receive = Reflect.get(journal, 'receive') as (reply: unknown) => void;
  let reply: unknown; let signal!: () => void; const observed = new Promise<void>(resolve => { signal = resolve; });
  const issue = journal.closeOutputDelivery.bind(journal);
  const spy = vi.spyOn(journal, 'closeOutputDelivery').mockImplementation(input => {
    const id = Number(Reflect.get(journal, 'nextId')) + 1;
    Reflect.set(journal, 'receive', (candidate: unknown) => {
      if (candidate && typeof candidate === 'object' && Reflect.get(candidate, 'id') === id) { reply = candidate; signal(); return; }
      receive.call(journal, candidate);
    });
    return issue(input);
  });
  return { spy, observed, deliver() { Reflect.set(journal, 'receive', receive); if (reply) { const value = reply; reply = undefined; receive.call(journal, value); } } };
}
