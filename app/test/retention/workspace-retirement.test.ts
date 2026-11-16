import {ParentRetentionSnapshots} from '../../src/adapters/outbound/sqlite/retention-parent/index.js';
import {ManualRunDeletionSnapshots} from '../../src/adapters/outbound/sqlite/retention-manual/index.js';
import {parentCommand} from './parent-fixture.js';
import {expect,it} from 'vitest';
import {selected} from './apply-fixture.js';
import {command,scope} from './selection-fixture.js';
import {prepareNamespaceDeletion} from '../../src/application/namespace-deletion/index.js';
import {digest,requestId} from '../storage/fixture.js';
import {rows} from '../storage/clock-reason/fixtures.js';
const deletion=()=>prepareNamespaceDeletion({kind:'workspace',id:scope.workspaceId,request:{scope:{kind:'organization',organizationId:scope.organizationId},requestId:requestId(),expectedVersion:1}},digest);
it('refuses unissued retention Apply and fresh preview after retirement without altering the captured candidates',()=>{
 const f=selected();try{
  f.observe();f.store.execute({kind:'deleteNamespace',command:deletion()});const before=rows(f.db);
  expect(()=>f.apply.apply(f.input)).toThrow('not_found');expect(rows(f.db)).toEqual(before);
  expect(()=>f.retention.preview(command(f))).toThrow('not_found');expect(rows(f.db)).toEqual(before);
 }finally{f.db.close();}
});
it('preserves an already admitted maintenance original and its exact Apply acknowledgement after retirement',()=>{
 const f=selected();try{
  const receipt=f.apply.apply(f.input);f.store.execute({kind:'deleteNamespace',command:deletion()});const before=rows(f.db);
  expect(f.apply.apply(f.input)).toEqual(receipt);expect(rows(f.db)).toEqual(before);
  expect(f.db.prepare('SELECT COUNT(*) n FROM output_deletion_intents').get()?.n).toBe(3);
  expect(f.db.prepare('SELECT COUNT(*) n FROM retention_progress').get()?.n).toBe(3);
  expect(f.reads.get({scope,id:f.page.candidates[0]!.id})).toMatchObject({id:f.page.candidates[0]!.id});
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.db.close();}
});

it('invalidates parent preview replay and continuation into a retired workspace while allowing a fresh traversal',()=>{
 const f=selected(4);try{
  const parent=new ParentRetentionSnapshots(f.db,f.reads);const input=parentCommand(f);const page=parent.preview(input);
  expect(page.nextCursor).not.toBeNull();f.store.execute({kind:'deleteNamespace',command:deletion()});const before=rows(f.db);
  expect(()=>parent.preview(input)).toThrow('not_found');
  expect(()=>parent.preview(parentCommand(f,1,page.nextCursor!))).toThrow('not_found');expect(rows(f.db)).toEqual(before);
  expect(parent.preview(parentCommand(f,2))).toMatchObject({workspace:null,durable:false,nextCursor:null});
 }finally{f.db.close();}
});
it('fences worker-level manual preview replay and fresh selection after retirement',()=>{
 const f=selected(1);try{
  const manual=new ManualRunDeletionSnapshots(f.db,f.reads);const candidate=f.page.candidates[0]!;
  const base=command(f,30);const {page,...request}=base.request;void page;
  const input={...base,request:{...request,runId:candidate.id,expectedRunVersion:candidate.version}};
  manual.preview(input);f.store.execute({kind:'deleteNamespace',command:deletion()});const before=rows(f.db);
  expect(()=>manual.preview(input)).toThrow('not_found');
  expect(()=>manual.preview({...input,request:{...input.request,requestId:requestId()}})).toThrow('not_found');expect(rows(f.db)).toEqual(before);
 }finally{f.db.close();}
});
