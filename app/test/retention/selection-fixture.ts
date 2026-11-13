import { WorkspaceRetentionSnapshots,previewCursor } from '../../src/adapters/outbound/sqlite/retention-selection/index.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { proposalFor,fixture,uuid,scope } from './fixture.js';
export { scope,uuid,previewCursor };
export function command(f:Parameters<typeof proposalFor>[0],sequence=0,limit=100,cursor?:string,target=scope){
 const p=proposalFor(f,sequence,target);return{id:p.id,capturedAt:p.capturedAt,request:{scope:target,requestId:p.requestId,settingsId:p.settings.workspace.id,expectedVersion:p.settings.workspace.version,page:{limit,...(cursor?{cursor}:{})}}};
}
export function history(count=21){
 const f=fixture(4_000_000);f.policy(values=>{values.retention={mode:'enabled',completedRunCount:20};});
 for(let i=0;i<count;i++){const key=f.add(70+i);f.store.execute({kind:'cancelRun',command:cancelCommand(key.runId,{scope,requestId:uuid(3000+i)})});}
 return{...f,retention:new WorkspaceRetentionSnapshots(f.db,f.reads)};
}
