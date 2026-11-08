import { afterAll, afterEach, beforeAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'tsup';
import type { Ack, ControlEvent, Offer } from '@beetle/contracts';
import { openJournal } from '../../src/journal/index.js';
import type { GenerationKey, Journal, SupervisorInput } from '../../src/journal/index.js';

export function journalFixture() {
  let root: string; let workerUrl: URL; let original: Offer; let progress: ControlEvent;
  let counter = 0; const handles = new Set<Journal>();
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'beetle-events-'));
    const outDir = join(root, 'worker');
    await build({ entry: ['agent/src/journal/worker.ts'], outDir, format: ['esm'],
      platform: 'node', target: 'node24', bundle: true, noExternal: [/.*/], shims: true,
      removeNodeProtocol: false, splitting: false, silent: true });
    workerUrl = pathToFileURL(join(outDir, 'worker.js'));
    original = JSON.parse(await readFile('contracts/fixtures/valid/offer.json', 'utf8')) as Offer;
    progress = JSON.parse(await readFile('contracts/fixtures/valid/wrapper-progress.json', 'utf8')) as ControlEvent;
  }, 20000);
  afterEach(async () => { await Promise.all([...handles].map(journal => journal.abort())); handles.clear(); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  return {
    path: () => join(root, `journal-${++counter}.sqlite`),
    workerUrl: () => workerUrl,
    offer: () => structuredClone(original),
    key: (): GenerationKey => ({ attemptId: original.attemptId, organizationId: original.organizationId,
      workspaceId: original.workspaceId, generation: 1 }),
    wrapper: (seq = 1): ControlEvent => ({ ...structuredClone(progress), seq }),
    supervisor: (sourceOrdinal = 1): SupervisorInput => ({ sourceOrdinal, event: {
      version: '1.0', attemptId: original.attemptId, organizationId: original.organizationId,
      workspaceId: original.workspaceId, generation: 1, phase: 'execute', source: 'agent',
      observedAt: '2026-01-01T00:00:00Z', kind: 'runtime.started', payload: { runtimeId: 'synthetic' },
    } }),
    ack: (throughSeq: number): Ack => ({ protocolVersion: '1.0', attemptId: original.attemptId,
      organizationId: original.organizationId, workspaceId: original.workspaceId, generation: 1, throughSeq }),
    async open(path?: string, spoolQuotaBytes?: number): Promise<Journal> {
      const journal = await openJournal({ path: path ?? this.path(), workerUrl,
        ...(spoolQuotaBytes === undefined ? {} : { spoolQuotaBytes }) });
      handles.add(journal); return journal;
    },
    async close(journal: Journal): Promise<void> { await journal.close(); handles.delete(journal); },
  };
}
