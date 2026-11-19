import {expect,it} from 'vitest';
import {scope,seed,storageFixture,uuid,requestId,digest} from '../fixture.js';
import {append,createSuite} from '../suites-fixture.js';
import {runCommand,runOptions,runRequest} from '../runs-fixture.js';
import {prepareCancelRunCommand} from '../../../src/application/runs/index.js';
import {pinCommand} from '../run-pin-fixtures.js';
const fixture=storageFixture();
it('returns opt-in scoped counts with real search/pin/note membership and unchanged default pages',async()=>{
 const metadata=await fixture.open(undefined,runOptions());await seed(metadata);
 const revision=await append(metadata,await createSuite(metadata,50,scope,'Counted suite'));
 for(const id of [500,501,502])await metadata.runs.execute(runCommand(revision.id,id,{...runRequest(revision.id),note:id===501?'Specific note match':null}));
 expect((await metadata.runs.listRuns({scope,limit:1})).counts).toBeUndefined();
 const first=await metadata.runs.listRuns({scope,limit:1,includeCounts:true});expect(first.counts).toMatchObject({all:3,matched:3,before:0});
 expect((await metadata.runs.listRuns({scope,limit:1,cursor:first.nextCursor!,includeCounts:true})).counts).toMatchObject({all:3,before:1});
 await metadata.runs.cancel(prepareCancelRunCommand({kind:'cancelRun',id:uuid(501),request:{scope,requestId:requestId()}},digest));
 await metadata.runs.pin(pinCommand('pinRun',uuid(501),requestId()));
 const page=await metadata.runs.listRuns({scope,limit:1,name:'specific note',pinned:true,includeCounts:true});
 expect(page.items.map(row=>row.id)).toEqual([uuid(501)]);expect(page.counts).toEqual({all:1,running:0,passed:0,failed:0,cancelled:1,pinned:1,matched:1,before:0});
});

it('keeps bounded pin searches working when optional context counts exceed prefix or note budgets',async()=>{
 const {inputOptions}=await import('../inputs-fixture.js');
 const metadata=await fixture.open(undefined,{...runOptions(512),...inputOptions(20_000_000)});await seed(metadata);
 const revision=await append(metadata,await createSuite(metadata,50,scope,'Bounded pinned suite'));
 for(let id=500;id<758;id++)await metadata.runs.execute(runCommand(revision.id,id,{...runRequest(revision.id),note:'Common pin note'}));
 await metadata.runs.cancel(prepareCancelRunCommand({kind:'cancelRun',id:uuid(500),request:{scope,requestId:requestId()}},digest));
 await metadata.runs.pin(pinCommand('pinRun',uuid(500),requestId()));
 for(const context of [{runIdPrefix:'00000000'},{name:'common pin note'}]){
  const plain=await metadata.runs.listRuns({scope,limit:1,pinned:true,...context});expect(plain.items.map(r=>r.id)).toEqual([uuid(500)]);
  const counted=await metadata.runs.listRuns({scope,limit:1,pinned:true,includeCounts:true,...context});expect(counted.items).toEqual(plain.items);
  expect(counted.counts).toBeUndefined();expect(counted.countsUnavailable).toBe('search_too_broad');
 }
});
