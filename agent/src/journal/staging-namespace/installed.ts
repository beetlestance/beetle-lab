import { randomUUID, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureInstalledRoot, installedRootDigest, captureNamespaceIntent, captureNamespaceState,
  sealNamespaceAnchor, namespaceCaps } from '../../staging-namespace/index.js';
import type { InstalledRootFacts, NamespaceIntent, NamespaceMarker, InstalledNamespaceState, InstalledNamespaceAnchor } from '../../staging-namespace/index.js';
import { Failure } from '../sql.js';
import { readJournalAuthority } from '../authority.js';
export function readInstalledNamespace(db: DatabaseSync): InstalledNamespaceState | null {
  const row = db.prepare('SELECT state,intent_json,anchor_json FROM installed_staging_namespace WHERE id=1').get();
  if (!row) return null;
  return captureNamespaceState({ state: row.state, intent: JSON.parse(String(row.intent_json)) as unknown,
    ...(row.anchor_json === null ? {} : { anchor: JSON.parse(String(row.anchor_json)) as unknown }) });
}
export function beginInstalledNamespace(db: DatabaseSync, root: InstalledRootFacts): NamespaceIntent {
  const expected = captureInstalledRoot(root); const existing = readInstalledNamespace(db);
  if (existing) {
    if (existing.state === 'preparing' && db.prepare('SELECT 1 FROM accepted_attempts LIMIT 1').get()) throw new Failure('recovery_required');
    if (existing.intent.rootDigest !== installedRootDigest(expected) || existing.intent.journalAuthority !== readJournalAuthority(db)) throw new Failure('recovery_required');
    return existing.intent;
  }
  if (db.prepare('SELECT 1 AS retained FROM accepted_attempts LIMIT 1').get()) throw new Failure('recovery_required');
  const intent = captureNamespaceIntent({ protocolVersion: 1, namespaceId: randomUUID(), journalAuthority: readJournalAuthority(db),
    root: expected, rootDigest: installedRootDigest(expected), nonce: randomBytes(32).toString('hex') });
  db.prepare("INSERT INTO installed_staging_namespace(id,state,namespace_id,intent_json) VALUES(1,'preparing',?,?)")
    .run(intent.namespaceId, encodeCanonicalJson(intent, namespaceCaps.intent));
  return intent;
}
export function commitInstalledNamespace(db: DatabaseSync, request: { intent: NamespaceIntent; marker: NamespaceMarker }): InstalledNamespaceAnchor {
  const state = readInstalledNamespace(db);
  if (!state || encodeCanonicalJson(state.intent, namespaceCaps.intent) !== encodeCanonicalJson(request.intent, namespaceCaps.intent)) throw new Failure('conflict');
  const anchor = sealNamespaceAnchor(request);
  if (state.state === 'bound') {
    if (anchor.namespaceIdentity !== state.anchor.namespaceIdentity) throw new Failure('conflict');
    return state.anchor;
  }
  if (db.prepare('SELECT 1 AS retained FROM accepted_attempts LIMIT 1').get()) throw new Failure('recovery_required');
  db.prepare("UPDATE installed_staging_namespace SET state='bound',namespace_identity=?,anchor_json=? WHERE id=1")
    .run(anchor.namespaceIdentity, encodeCanonicalJson(anchor, namespaceCaps.anchor));
  return anchor;
}
