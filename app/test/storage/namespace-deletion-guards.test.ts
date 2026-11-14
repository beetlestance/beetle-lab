import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { expect, it, vi } from 'vitest';
import { fixture as retentionFixture, usage } from '../retention/fixture.js';
import { prepareNamespaceDeletion } from '../../src/application/namespace-deletion/index.js';
import { command, digest, requestId, scope, uuid, settingsFixture, observation } from './fixture.js';
function fixture() {
 const db=initialize(':memory:');const settings=settingsFixture();
 const store=new Store(db,{installation:settings.chain.installation,runtime:observation()});
 store.execute({kind:'namespace',command:command({kind:'createOrganization',id:uuid(1),request:{scope:{kind:'installation'},requestId:requestId(),name:'Empty',slug:'empty'}})});
 store.execute({kind:'namespace',command:command({kind:'createWorkspace',id:uuid(2),rootFolderId:uuid(3),request:{scope:{kind:'organization',organizationId:uuid(1)},requestId:requestId(),name:'Empty'}})});
 return {db,store};
}
const deletion = () => prepareNamespaceDeletion({kind:'workspace',id:scope.workspaceId,request:{scope:{kind:'organization',organizationId:scope.organizationId},requestId:requestId(),expectedVersion:1}},digest);
it('preserves retention snapshots/epochs, charges and root/settings on FK refusal',()=>{
 const f=retentionFixture();try{
  f.reserve();const before=usage(f.db);
  expect(()=>f.store.execute({kind:'deleteNamespace',command:deletion()})).toThrow();
  expect(usage(f.db)).toBe(before);expect(f.db.prepare('SELECT count(*) n FROM namespace_deletions').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT count(*) n FROM retention_workspace_epochs').get()?.n).toBe(1);
  expect(f.db.prepare('SELECT id FROM workspaces WHERE id=?').get(scope.workspaceId)?.id).toBe(scope.workspaceId);
 }finally{f.db.close();}
});
it('funds exactly 2048 once and refuses one-byte-short capacity without partial mutation',()=>{
 for(const spare of [2047,2048]){
  const f=fixture();try{
   f.db.prepare('UPDATE settings SET value_json=json_set(value_json,\'$.pool.storageBytes\',?,\'$.pool.freeSpaceReserveBytes\',0) WHERE scope_key=\'installation\'').run(spare);
   const intent=deletion();
   if(spare===2047){expect(()=>f.store.execute({kind:'deleteNamespace',command:intent})).toThrow('Capacity unavailable');expect(usage(f.db)).toBe(0);}
   else{f.store.execute({kind:'deleteNamespace',command:intent});expect(usage(f.db)).toBe(2048);f.store.execute({kind:'deleteNamespace',command:intent});expect(usage(f.db)).toBe(2048);}
  }finally{f.db.close();}
 }
});
it('rolls back paid marker and entity removal on a late receipt failure',()=>{
 const f=fixture();try{
  f.db.exec("CREATE TRIGGER fail_delete_receipt BEFORE INSERT ON receipts WHEN json_extract(NEW.result_json,'$.state')='tombstoned' BEGIN SELECT RAISE(ABORT,'synthetic late receipt'); END");
  expect(()=>f.store.execute({kind:'deleteNamespace',command:deletion()})).toThrow('synthetic late receipt');
  expect(usage(f.db)).toBe(0);expect(f.db.prepare('SELECT count(*) n FROM namespace_deletions').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT id FROM folders WHERE id=?').get(uuid(3))?.id).toBe(uuid(3));
 }finally{f.db.close();}
});
it('rejects raw deletion, forged binding, marker edits and recreation of entity/root/settings IDs including case aliases',()=>{
 const f=fixture();try{
  const settingsId=f.db.prepare("SELECT id FROM settings WHERE kind='workspace'").get()?.id;
  expect(()=>f.db.prepare('DELETE FROM workspaces WHERE id=?').run(scope.workspaceId)).toThrow();
  expect(()=>f.db.prepare("INSERT INTO namespace_deletions VALUES(?,'workspace',?,2,?,?,2048)").run(scope.workspaceId,'organization:'+uuid(99),uuid(3),settingsId!)).toThrow();
  f.store.execute({kind:'deleteNamespace',command:deletion()});
  expect(()=>f.db.exec('DELETE FROM namespace_deletions')).toThrow();expect(()=>f.db.exec('UPDATE namespace_deletions SET charged_bytes=2048')).toThrow();
  const org=command({kind:'createOrganization',id:scope.workspaceId,request:{scope:{kind:'installation'},requestId:requestId(),name:'Alias',slug:'alias'}});
  expect(()=>f.store.execute({kind:'namespace',command:org})).toThrow('deleted namespace identity');
  for(const id of [scope.workspaceId,uuid(3),String(settingsId)]){
   expect(()=>f.db.prepare('INSERT INTO organizations VALUES(?,1,\'Alias\',\'alias\')').run(id.toUpperCase())).toThrow('deleted namespace identity');
  }
  expect(usage(f.db)).toBe(2048);expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.db.close();}
});

it('uses indexed scoped emptiness and foreign-key checks with unrelated folders present',()=>{
 const f=fixture();try{
  f.store.execute({kind:'namespace',command:command({kind:'createWorkspace',id:uuid(10),rootFolderId:uuid(11),request:{scope:{kind:'organization',organizationId:uuid(1)},requestId:requestId(),name:'Unrelated'}})});
  for(let i=0;i<200;i++)f.db.prepare('INSERT INTO folders VALUES(?,?,?,?,1,?,?)').run(uuid(4000+i),uuid(1),uuid(10),uuid(11),'Unrelated '+i,'unrelated '+i);
  const prepare=vi.spyOn(f.db,'prepare');f.store.execute({kind:'deleteNamespace',command:deletion()});
  const query=prepare.mock.calls.map(row=>row[0]).find(sql=>sql.startsWith('SELECT (EXISTS'));prepare.mockRestore();
  expect(query).toContain('organization_id=target.organization_id AND workspace_id=target.id');
  const probe=f.db.prepare('EXPLAIN QUERY PLAN '+query!).all(uuid(2));
  expect(probe.every(row=>!String(row.detail).includes('SCAN '))).toBe(true);
  for(const table of ['organizations','workspaces','folders','settings']){
   const plan=f.db.prepare(`EXPLAIN QUERY PLAN DELETE FROM ${table} WHERE id=?`).all(uuid(2));
   expect(plan.filter(row=>String(row.detail).includes('SCAN '))).toEqual([]);
  }
 }finally{f.db.close();}
});

it('refuses a wide same-target namespace before marker insertion or parent DELETE',()=>{
 const f=fixture();try{
  for(let i=0;i<500;i++)f.db.prepare('INSERT INTO folders VALUES(?,?,?,?,1,?,?)').run(uuid(6000+i),uuid(1),uuid(2),uuid(3),'Child '+i,'child '+i);
  const prepare=vi.spyOn(f.db,'prepare');expect(()=>f.store.execute({kind:'deleteNamespace',command:deletion()})).toThrow('conflict');
  expect(prepare.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO namespace_deletions')||sql.startsWith('DELETE FROM'))).toBe(false);
  prepare.mockRestore();expect(usage(f.db)).toBe(0);
  const settingsId=f.db.prepare("SELECT id FROM settings WHERE kind='workspace'").get()?.id;
  if(typeof settingsId!=='string')throw Error('Missing synthetic settings');
  expect(()=>f.db.prepare("INSERT INTO namespace_deletions VALUES(?,'workspace',?,2,?,?,2048)").run(uuid(2),'organization:'+uuid(1),uuid(3),settingsId)).toThrow('namespace not empty');
  expect(usage(f.db)).toBe(0);
 }finally{f.db.close();}
});
