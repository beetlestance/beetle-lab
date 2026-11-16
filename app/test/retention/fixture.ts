import type { SettingsChain } from '../../src/domain/settings/index.js';
import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { RetentionSnapshot } from '../../src/domain/retention/index.js';
import { reserveRetentionSnapshot } from '../../src/adapters/outbound/sqlite/retention-accounting/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { claimsFixture,custody } from '../storage/dispatch-claim-fixtures.js';
import { scope,uuid,command } from '../storage/fixture.js';
export { uuid,scope,custody };
export const now=Date.parse('2026-11-14T12:00:00.000Z');
function sourceFor(chain:SettingsChain){
 if(chain.workspace?.overrides.retention!==undefined)return chain.workspace.scope;
 if(chain.organization?.overrides.retention!==undefined)return chain.organization.scope;
 return chain.installation.scope;
}
export function proposalFor(f:Pick<ReturnType<typeof claimsFixture>,'db'|'settings'>,sequence=0,target:WorkspaceScope=scope):RetentionSnapshot{
  const chain=f.settings.chain(target);if(!chain.organization||!chain.workspace)throw Error('Missing synthetic scope');
  const source=sourceFor(chain);
  const policy=chain.workspace.overrides.retention??chain.organization.overrides.retention??chain.installation.values.retention;
  const epoch=f.db.prepare('SELECT epoch FROM retention_workspace_epochs WHERE workspace_id=?').get(target.workspaceId)?.epoch;
  return{version:1,id:uuid(1000+sequence),kind:'retention',scope:target,requestId:uuid(2000+sequence),intentDigest:'f'.repeat(64),capturedAt:'2026-11-14T12:00:00.000Z',expiresAt:'2026-11-14T12:15:00.000Z',
   settings:{installation:{id:chain.installation.id,version:chain.installation.version},organization:{id:chain.organization.id,version:chain.organization.version},workspace:{id:chain.workspace.id,version:chain.workspace.version}},
   policy,policySource:source,epoch:typeof epoch==='number'?epoch:1,predecessorId:null,before:{completedCount:0,logicalBytes:0},after:{completedCount:0,logicalBytes:0},scanned:0,cursor:null,hasMore:false,candidates:[],exclusions:[]};
}
export function fixture(storageBytes=2_000_000){
 const f=claimsFixture(storageBytes);const proposal=(sequence=0,target=scope)=>proposalFor(f,sequence,target);
 return{...f,proposal,reserve:(input=proposal(),clock=now)=>transaction(f.db,()=>reserveRetentionSnapshot(f.db,input,clock))};
}
export function usage(db:DatabaseSync){return db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;}

export function otherWorkspace(f:Pick<ReturnType<typeof claimsFixture>,'store'>){
 const target={kind:'workspace' as const,organizationId:uuid(21),workspaceId:uuid(22)};
 f.store.execute({kind:'namespace',command:command({kind:'createOrganization',id:uuid(21),request:{scope:{kind:'installation'},requestId:uuid(30000),name:'Other retention',slug:'other-retention'}})});
 f.store.execute({kind:'namespace',command:command({kind:'createWorkspace',id:uuid(22),rootFolderId:uuid(23),request:{scope:{kind:'organization',organizationId:uuid(21)},requestId:uuid(30001),name:'Other retention'}})});
 return target;
}
