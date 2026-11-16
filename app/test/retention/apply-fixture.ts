import { WorkspaceRetentionApplies } from '../../src/adapters/outbound/sqlite/retention-apply/index.js';
import { history,command,scope,uuid } from './selection-fixture.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { pruneRetentionSnapshots } from '../../src/adapters/outbound/sqlite/retention-accounting/index.js';
export function selected(count=3){
 const f=history(count);f.policy(values=>{values.retention={mode:'enabled',ageDays:1};});const page=f.retention.preview(command(f));
 const request={scope,requestId:uuid(50000),settingsId:page.settings.workspace.id,expectedVersion:page.settings.workspace.version,snapshotId:page.id,snapshotVersion:1,page:{limit:page.candidates.length}};
 const input={id:uuid(50001),appliedAt:'2026-11-14T12:01:00.000Z',request};return{...f,page,input,observe:()=>transaction(f.db,()=>pruneRetentionSnapshots(f.db,Date.parse(input.appliedAt))),apply:new WorkspaceRetentionApplies(f.db,f.reads)};
}
