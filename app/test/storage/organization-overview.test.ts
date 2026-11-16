import {initialize} from '../../src/adapters/outbound/sqlite/schema.js';
import {expect,it} from 'vitest';
import {storageFixture,seed,scope,uuid,command,digest,requestId} from './fixture.js';
import {append,createSuite,request as revisionRequest,suiteCommand} from './suites-fixture.js';
import {runOptions,runRequest} from './runs-fixture.js';
import {prepareRunCommand} from '../../src/application/runs/index.js';
const fixture=storageFixture();const now='2026-11-14T12:00:00.000Z';
it('aggregates all workspaces within one organisation and preserves scoped links across worker reopen',async()=>{
 const path=fixture.path();let metadata=await fixture.open(path,runOptions());await seed(metadata);await seed(metadata,11,12,13);
 await metadata.namespaces.execute(command({kind:'createWorkspace',id:uuid(21),rootFolderId:uuid(22),request:{scope:{kind:'organization',organizationId:uuid(1)},requestId:requestId(),name:'Second'}}));
 const first=await append(metadata,await createSuite(metadata));
 const secondScope={...scope,workspaceId:uuid(21)};
 await metadata.suites.execute(suiteCommand({kind:'createSuite',id:uuid(51),request:{scope:secondScope,requestId:requestId(),name:'Second suite'}}));
 const second=await metadata.suites.execute(suiteCommand({kind:'createSuiteRevision',id:uuid(61),suiteId:uuid(51),request:{...revisionRequest(),scope:secondScope}}));
 expect('config' in second).toBe(true);
 for(let n=0;n<33;n++){
  const owner=n%2===0?scope:secondScope;const revisionId=n%2===0?first.id:uuid(61);
  await metadata.runs.execute(prepareRunCommand({kind:'createRun',id:uuid(500+n),attemptId:uuid(1500+n),requestedAt:n===0?'2026-11-13T12:00:00.000Z':n===1?now:'2026-11-14T11:00:00.000Z',request:{...runRequest(revisionId),scope:owner}},digest));
 }
 await fixture.close(metadata);const db=initialize(path);db.prepare("UPDATE runs SET state='active' WHERE organization_id=? AND id>=? AND id<?").run(uuid(1),uuid(500),uuid(525));db.close();metadata=await fixture.open(path,runOptions());
 const query={scope:{kind:'organization' as const,organizationId:uuid(1)},now};const snapshot=await metadata.organizationOverview.read(query);
 expect(snapshot.workspaces).toBe(2);expect(snapshot.counts).toMatchObject({folders:2,suites:2,runs:33,queued:8,active:25,submitted24h:32});
 expect(snapshot.recent).toHaveLength(8);expect(snapshot.active).toHaveLength(20);expect(snapshot.activeHasMore).toBe(true);expect(snapshot.activity.reduce((n,b)=>n+b.count,0)).toBe(32);
 expect(new Set(snapshot.recent.map(row=>row.workspaceId))).toEqual(new Set([uuid(2),uuid(21)]));
 expect((await metadata.organizationOverview.read({scope:{kind:'organization',organizationId:uuid(11)},now})).counts.runs).toBe(0);
 await expect(metadata.organizationOverview.read({scope:{kind:'organization',organizationId:uuid(99)},now})).rejects.toMatchObject({code:'not_found'});
 await fixture.close(metadata);metadata=await fixture.open(path,runOptions());expect(await metadata.organizationOverview.read(query)).toEqual(snapshot);
});
it('represents a truly empty organisation and refuses malformed clocks',async()=>{
 const metadata=await fixture.open();await metadata.namespaces.execute(command({kind:'createOrganization',id:uuid(1),request:{scope:{kind:'installation'},requestId:requestId(),name:'Empty',slug:'empty'}}));
 const value=await metadata.organizationOverview.read({scope:{kind:'organization',organizationId:uuid(1)},now});
 expect(value.workspaces).toBe(0);expect(value.counts.runs).toBe(0);expect(value.recent).toEqual([]);
 await expect(metadata.organizationOverview.read({scope:value.scope,now:'2026-02-30T12:00:00.000Z'})).rejects.toMatchObject({code:'invalid_value'});
});
