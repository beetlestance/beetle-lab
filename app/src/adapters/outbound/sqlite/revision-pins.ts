import type {DatabaseSync} from 'node:sqlite';
import type {SuiteRevision} from '@beetle/contracts/api';
import {requireRule} from '../../../domain/namespaces/index.js';
/** Caller owns the same transaction as immutable revision/intent capture. */
export function checkRevisionPins(db:DatabaseSync,revision:SuiteRevision):void {
 for(const pin of revision.inputManifest){
  const row=db.prepare(`SELECT id FROM input_blobs WHERE organization_id=? AND workspace_id=?
   AND id=? AND sha256=? AND bytes=? AND state='published'`).get(revision.scope.organizationId,revision.scope.workspaceId,pin.id,pin.sha256,pin.bytes);
  requireRule(row!==undefined,'not_found');
 }
}
