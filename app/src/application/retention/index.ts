import type { RetentionTraversalPage } from '@beetle/contracts/api';
import type { ParentRetentionPage } from '../../ports/retention.js';
import type { RetentionPreview } from '@beetle/contracts/api';
import type { RetentionSnapshot } from '../../domain/retention/index.js';
/** Public projection omits private mutation identities and authority digests. */
export function retentionPreview(snapshot:RetentionSnapshot):RetentionPreview{
 return{snapshotId:snapshot.id,version:1,scope:snapshot.scope,requestId:snapshot.requestId,settingsId:snapshot.settings.workspace.id,settingsVersion:snapshot.settings.workspace.version,
  policy:snapshot.policy,kind:snapshot.kind,capturedAt:snapshot.capturedAt,expiresAt:snapshot.expiresAt,scanned:snapshot.scanned,
  candidates:snapshot.candidates.map(member=>({id:member.id,version:member.version,scope:snapshot.scope,estimatedBytes:member.estimatedBytes,reason:member.reason})),
  estimatedBytes:snapshot.candidates.reduce((sum,member)=>sum+member.estimatedBytes,0),protectedExclusions:snapshot.exclusions.map(item=>({...item})),
  nextCursor:snapshot.hasMore&&!snapshot.traversal?btoa(snapshot.id):null};
}

export function retentionTraversal(page:ParentRetentionPage):RetentionTraversalPage{
 return{...page,workspace:page.workspace===null?null:retentionPreview(page.workspace)};
}
