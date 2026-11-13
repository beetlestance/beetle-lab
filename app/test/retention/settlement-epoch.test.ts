import { it,expect } from 'vitest';
import { fixture as settledFixture,snapshot } from '../backend-settlement/fixture.js';
import { command,uuid } from '../storage/fixture.js';
import { proposalFor,now,usage,scope } from './fixture.js';
import { reserveRetentionSnapshot } from '../../src/adapters/outbound/sqlite/retention-accounting/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
function funded(){
 const f=settledFixture();f.policy(values=>{values.pool.storageBytes=2_000_000;});
 transaction(f.db,()=>reserveRetentionSnapshot(f.db,proposalFor(f),now));return f;
}
it('advances the actual original epoch once through purge, retaining prepaid snapshot/epoch debt and exact replay',()=>{
 const f=funded();const before=Number(usage(f.db));const result=f.settle();
 expect(usage(f.db)).toBe(before-result.refundedBytes);expect(usage(f.db)).toBe(2560+131072+512);
 expect(f.db.prepare('SELECT epoch FROM retention_workspace_epochs WHERE workspace_id=?').get(scope.workspaceId)?.epoch).toBe(2);
 const stable=snapshot(f);expect(f.settle()).toEqual(result);expect(snapshot(f)).toBe(stable);
 expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(1);
});
it.each(['before_run','same_original','other_workspace'])('refuses nested epoch updates outside exact once-only original purge: %s',mode=>{
 const f=funded();const otherScope={kind:'workspace' as const,organizationId:uuid(21),workspaceId:uuid(22)};
 f.store.execute({kind:'namespace',command:command({kind:'createOrganization',id:uuid(21),request:{scope:{kind:'installation'},requestId:uuid(2400),name:'Other epoch',slug:'other-epoch'}})});
 f.store.execute({kind:'namespace',command:command({kind:'createWorkspace',id:uuid(22),rootFolderId:uuid(23),request:{scope:{kind:'organization',organizationId:uuid(21)},requestId:uuid(2401),name:'Other epoch'}})});
 transaction(f.db,()=>reserveRetentionSnapshot(f.db,proposalFor(f,1,otherScope),now));
 const target=mode==='other_workspace'?otherScope.workspaceId:scope.workspaceId;
 const table=mode==='before_run'?'backend_output_cleanup_acks':'runs';
 f.db.exec(`CREATE TRIGGER synthetic_epoch_nested BEFORE DELETE ON ${table} BEGIN UPDATE retention_workspace_epochs SET epoch=epoch+1 WHERE workspace_id='${target}';END`);
 const before=snapshot(f);expect(()=>f.settle()).toThrow();expect(snapshot(f)).toBe(before);
});
it('rolls the epoch increment, original purge and credit back after an actual epoch-write failure',()=>{
 const f=funded();f.db.exec("CREATE TRIGGER synthetic_epoch_late AFTER UPDATE ON retention_workspace_epochs BEGIN SELECT RAISE(ABORT,'synthetic epoch close failure');END");
 const before=snapshot(f);expect(()=>f.settle()).toThrow();expect(snapshot(f)).toBe(before);
 f.db.exec('DROP TRIGGER synthetic_epoch_late');f.settle();expect(f.db.prepare('SELECT epoch FROM retention_workspace_epochs').get()?.epoch).toBe(2);
});
it('fails closed at the exact epoch integer ceiling instead of wrapping or resetting',()=>{
 const f=funded();const trigger=f.db.prepare("SELECT sql FROM sqlite_master WHERE name='retention_epoch_update'").get()?.sql;
 // Quiescent synthetic near-ceiling fixture, then restore the exact production guard.
 expect(typeof trigger).toBe('string');f.db.exec('DROP TRIGGER retention_epoch_update');
 f.db.prepare('UPDATE retention_workspace_epochs SET epoch=?').run(Number.MAX_SAFE_INTEGER);f.db.exec(String(trigger));
 const before=snapshot(f);expect(()=>f.settle()).toThrow();expect(snapshot(f)).toBe(before);
});
