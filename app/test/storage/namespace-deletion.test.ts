import { createInput, inputOptions } from './inputs-fixture.js';
import { expect, it } from 'vitest';
import { prepareNamespaceDeletion } from '../../src/application/namespace-deletion/index.js';
import { storageFixture, seed, createFolder, command, requestId, scope, uuid, digest } from './fixture.js';
import { createSuite } from './suites-fixture.js';
const fixture = storageFixture();
const folder = (id = uuid(4), expectedVersion = 1) => prepareNamespaceDeletion({kind:'folder',id,
  request:{scope,requestId:requestId(),expectedVersion}},digest);
const workspace = () => prepareNamespaceDeletion({kind:'workspace',id:uuid(2),request:{
  scope:{kind:'organization',organizationId:uuid(1)},requestId:requestId(),expectedVersion:1}},digest);
it('deletes an empty workspace/root/settings once and replays before live lookup after worker reopen',async()=>{
 const path=fixture.path();let metadata=await fixture.open(path);await seed(metadata);
 const intent=workspace();const originalUsage=await metadata.inputs.storage();
 const result=await metadata.namespaceDeletions.delete(intent);
 expect(result).toMatchObject({id:uuid(2),version:2,state:'tombstoned',cleanup:'complete'});
 await expect(metadata.get({kind:'workspace',id:uuid(2),scope:intent.request.scope})).rejects.toMatchObject({code:'not_found'});
 await expect(metadata.get({kind:'folder',id:uuid(3),scope})).rejects.toMatchObject({code:'not_found'});
 await expect(metadata.getSettings(scope)).rejects.toMatchObject({code:'not_found'});
 expect((await metadata.inputs.storage()).chargedBytes).toBe(originalUsage.chargedBytes+2048);
 await fixture.close(metadata);metadata=await fixture.open(path);
 expect(await metadata.namespaceDeletions.delete(intent)).toEqual(result);
 expect((await metadata.inputs.storage()).chargedBytes).toBe(originalUsage.chargedBytes+2048);
 await expect(metadata.namespaceDeletions.delete({...intent,intentDigest:'0'.repeat(64)})).rejects.toMatchObject({code:'invalid_input'});
});
it('refuses root, nonempty, foreign and stale deletions without changing storage or data',async()=>{
 const metadata=await fixture.open();await seed(metadata);await seed(metadata,20,21,22);await createFolder(metadata,4);await createFolder(metadata,5,uuid(4));
 const before=await metadata.inputs.storage();
 for(const intent of [folder(uuid(3)),folder(),folder(uuid(5),2),workspace(),
   prepareNamespaceDeletion({kind:'folder',id:uuid(4),request:{scope:{...scope,organizationId:uuid(20),workspaceId:uuid(21)},expectedVersion:1,requestId:requestId()}},digest)]){
  await expect(metadata.namespaceDeletions.delete(intent)).rejects.toMatchObject({code:intent.request.scope.kind==='workspace'&&intent.request.scope.organizationId===uuid(20)?'not_found':'conflict'});
 }
 expect(await metadata.inputs.storage()).toEqual(before);expect((await metadata.get({kind:'folder',id:uuid(4),scope})).id).toBe(uuid(4));
});
it('retains suite dependencies and cannot delete a parent organisation until its workspace is empty and removed',async()=>{
 const metadata=await fixture.open();await seed(metadata);await createSuite(metadata);
 const intent=workspace();await expect(metadata.namespaceDeletions.delete(intent)).rejects.toMatchObject({code:'conflict'});
 const org=prepareNamespaceDeletion({kind:'organization',id:uuid(1),request:{scope:{kind:'installation'},expectedVersion:1,requestId:requestId()}},digest);
 await expect(metadata.namespaceDeletions.delete(org)).rejects.toMatchObject({code:'conflict'});
 expect((await metadata.inputs.storage()).chargedBytes).toBe(0);
});
it('keeps deletion and create receipts while refusing reuse of removed root/entity identities',async()=>{
 const metadata=await fixture.open();const created=await seed(metadata);await createFolder(metadata,4);
 const intent=folder();await metadata.namespaceDeletions.delete(intent);
 await expect(createFolder(metadata,4)).rejects.toMatchObject({code:'conflict'});
 await expect(metadata.namespaceDeletions.delete(prepareNamespaceDeletion({kind:'folder',id:intent.id,request:{scope,requestId:intent.request.requestId,expectedVersion:2}},digest))).rejects.toMatchObject({code:'conflict'});
 await metadata.namespaceDeletions.delete(workspace());
 await expect(metadata.namespaces.execute(command({kind:'createWorkspace',id:uuid(2),rootFolderId:uuid(30),request:{scope:created.workspace.scope,requestId:requestId(),name:'Again'}}))).rejects.toMatchObject({code:'conflict'});
 const deleted=await metadata.namespaceDeletions.delete(prepareNamespaceDeletion({kind:'organization',id:uuid(1),request:{scope:{kind:'installation'},requestId:requestId(),expectedVersion:1}},digest));
 expect(deleted.cleanup).toBe('complete');expect((await metadata.inputs.storage()).chargedBytes).toBe(6144);
});

it('retains original create replay without resurrecting a deleted folder and protects input owners',async()=>{
 const metadata=await fixture.open(undefined,inputOptions());await seed(metadata);
 const create=command({kind:'createFolder',id:uuid(4),request:{scope,requestId:requestId(),name:'Replay',parentFolderId:uuid(3)}});
 const original=await metadata.namespaces.execute(create);await metadata.namespaceDeletions.delete(folder());
 expect(await metadata.namespaces.execute(create)).toEqual(original);
 await expect(metadata.get({kind:'folder',id:uuid(4),scope})).rejects.toMatchObject({code:'not_found'});
 const input=await metadata.inputs.control(createInput());const before=await metadata.inputs.storage();
 await expect(metadata.namespaceDeletions.delete(workspace())).rejects.toMatchObject({code:'conflict'});
 expect(await metadata.inputs.storage()).toEqual(before);expect(input.id).toBe(uuid(90));
});
it('deletes existing URN UUID identities without aliasing their bare spelling',async()=>{
 const metadata=await fixture.open();const id='urn:uuid:abcdefab-cdef-4abc-8def-abcdefabcdef';
 await metadata.namespaces.execute(command({kind:'createOrganization',id,request:{scope:{kind:'installation'},requestId:requestId(),name:'URN',slug:'urn'}}));
 const intent=prepareNamespaceDeletion({kind:'organization',id:id.toUpperCase(),request:{scope:{kind:'installation'},expectedVersion:1,requestId:requestId()}},digest);
 expect((await metadata.namespaceDeletions.delete(intent)).id).toBe(id);
 await expect(metadata.namespaceDeletions.delete(prepareNamespaceDeletion({kind:'organization',id:id.slice(9),request:{scope:{kind:'installation'},expectedVersion:1,requestId:requestId()}},digest))).rejects.toMatchObject({code:'not_found'});
});
