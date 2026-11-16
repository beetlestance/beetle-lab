import {cancelCommand} from './run-cancellation-fixtures.js';
import {expect,it} from 'vitest';
import {claimsFixture} from './dispatch-claim-fixtures.js';
import {snapshotFor} from './execution-foundation-fixtures.js';
import {prepareNamespaceDeletion} from '../../src/application/namespace-deletion/index.js';
import {digest,requestId,scope} from './fixture.js';
import {rows} from './clock-reason/fixtures.js';
const deletion=()=>prepareNamespaceDeletion({kind:'workspace',id:scope.workspaceId,request:{scope:{kind:'organization',organizationId:scope.organizationId},requestId:requestId(),expectedVersion:1}},digest);
it.each(['queued','dispatching','active','finalizing'] as const)('refuses %s work without changing a row or counter',state=>{
 const f=claimsFixture();try{
  f.add();f.db.prepare('UPDATE runs SET state=?').run(state);const before=rows(f.db);
  expect(()=>f.store.execute({kind:'deleteNamespace',command:deletion()})).toThrow('conflict');expect(rows(f.db)).toEqual(before);
 }finally{f.db.close();}
});
it('retains reconciliation authority for terminal but charged execution; permits retirement only after release',()=>{
 const f=claimsFixture();try{
  const key=f.add();expect(f.claims.claim(key).kind).toBe('claimed');
  f.observations.observe({journalAuthority:'33333333-3333-4333-8333-333333333333',key,snapshot:snapshotFor(key)});
  f.db.exec("UPDATE runs SET state='errored',outcome='inconclusive',reason='engine_crash'");const before=rows(f.db);
  expect(()=>f.store.execute({kind:'deleteNamespace',command:deletion()})).toThrow('conflict');expect(rows(f.db)).toEqual(before);
  expect(f.claims.scan({lane:'reconcile',limit:32}).items).toHaveLength(1);f.release(key);
  const charged=f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes;
  expect(f.store.execute({kind:'deleteNamespace',command:deletion()})).toMatchObject({state:'tombstoned'});
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(Number(charged)+2048);
  expect(f.db.prepare('SELECT COUNT(*) n FROM attempt_output_allocations').get()?.n).toBe(1);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.db.close();}
});

it('excludes retired folders, suites, terminal runs, recent entries and activity from organisation aggregates',()=>{
 const f=claimsFixture();try{
  const key=f.add();f.store.execute({kind:'cancelRun',command:cancelCommand(key.runId,{scope,requestId:requestId()})});
  const query={scope:{kind:'organization' as const,organizationId:scope.organizationId},now:'2026-11-09T12:00:00.000Z'};
  expect(f.store.execute({kind:'getOrganizationOverview',query})).toMatchObject({workspaces:1,counts:{folders:1,suites:1,runs:1},recent:[{id:key.runId}]});
  f.store.execute({kind:'deleteNamespace',command:deletion()});
  expect(f.store.execute({kind:'getOrganizationOverview',query})).toMatchObject({workspaces:0,counts:{folders:0,suites:0,runs:0,submitted24h:0},recent:[],active:[]});
  expect(f.db.prepare('SELECT COUNT(*) n FROM runs').get()?.n).toBe(1);
 }finally{f.db.close();}
});
