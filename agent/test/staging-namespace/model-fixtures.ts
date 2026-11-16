import type { DatabaseSync } from 'node:sqlite';
import { NamespaceStore } from '../../src/journal/staging-namespace/index.js';
import { captureNamespaceIntent } from '../../src/staging-namespace/index.js';
import { createHash } from 'node:crypto';
import type { Journal } from '../../src/journal/index.js';
import { namespaceMarkerBytes } from '../../src/staging-namespace/index.js';
import type { InstalledRootFacts, NamespaceIntent, NamespaceMarker, TaskDirectoryFacts } from '../../src/staging-namespace/index.js';
/** Metadata-only fixture values. They establish no native filesystem evidence. */
export const rootFacts: InstalledRootFacts = { protocolVersion: 1, installationId: '00000000-0000-4000-8000-000000000010',
  daemonId: 'synthetic-daemon', source: '/synthetic/staging', target: '/synthetic/staging',
  native: { dev: '9007199254740993', ino: '9007199254740995', uid: '10001', gid: '10001', mode: String(0o40700) } };
export function syntheticMarker(intent: NamespaceIntent, ino = '9007199254740997'): NamespaceMarker {
  const bytes = namespaceMarkerBytes(intent);
  return { ...intent.root.native, ino, mode: String(0o100400), bytes: String(bytes.byteLength), links: '1',
    sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function bindSyntheticNamespace(journal: Journal) {
  const intent = await journal.stagingNamespace.begin(rootFacts);
  return journal.stagingNamespace.commit({ intent, marker: syntheticMarker(intent) });
}
export function directories(): TaskDirectoryFacts {
  return Object.fromEntries(['task', 'input', 'output', 'secrets'].map((role, n) =>
    [role, { ...rootFacts.native, ino: String(20 + n) }])) as unknown as TaskDirectoryFacts;
}

/** Synchronous metadata-store fixture equivalent; no filesystem proof is claimed. */
export function bindSyntheticStore(db: DatabaseSync): void {
  const store = new NamespaceStore(db);
  const intent = captureNamespaceIntent(store.execute({ kind: 'namespaceBegin', id: 1, json: JSON.stringify(rootFacts) }));
  store.execute({ kind: 'namespaceCommit', id: 2, json: JSON.stringify({ intent, marker: syntheticMarker(intent) }) });
}
