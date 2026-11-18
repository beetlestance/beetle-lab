import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { prepareRunNoteCommand } from '../../src/application/runs/index.js';
import { storageFixture, seed, scope, requestId, digest } from './fixture.js';
import { createSuite, append } from './suites-fixture.js';
import { runOptions, runCommand, runRequest } from './runs-fixture.js';
const f = storageFixture();
it('commits the initial note with the run and replays the original note after an edit and reopen', async () => {
  const path=f.path(); const metadata=await f.open(path,runOptions()); await seed(metadata);
  const revision=await append(metadata,await createSuite(metadata));
  const body={...runRequest(revision.id),note:' After connection-pool fix '};
  const command=runCommand(revision.id,70,body);
  const run=await metadata.runs.execute(command);
  expect(run).toMatchObject({note:'After connection-pool fix',noteVersion:1,version:1});
  expect(await metadata.runs.getRun({scope,id:run.id})).toEqual(run);
  for(let step=0;step<40;step++){
    try {
      const page=await metadata.runs.listRuns({scope,limit:100,name:'connection-pool'});
      expect(page.items.map(item=>item.id)).toEqual([run.id]);break;
    } catch(error) {
      if(!(error instanceof Error)||!('code' in error)||error.code!=='search_indexing'||step===39)throw error;
    }
  }
  const changed=await metadata.runs.setNote(prepareRunNoteCommand({kind:'setRunNote',id:run.id,
    request:{scope,requestId:requestId(),expectedNoteVersion:1,note:'Updated annotation'}},digest));
  expect(changed).toMatchObject({note:'Updated annotation',noteVersion:2});
  expect(await metadata.runs.execute(runCommand(revision.id,71,body))).toEqual(run);
  await expect(metadata.runs.execute(runCommand(revision.id,72,{...body,note:'Different'}))).rejects.toMatchObject({code:'conflict'});
  await f.close(metadata);
  const raw=new DatabaseSync(path,{readOnly:true});
  try {expect(JSON.parse(String(raw.prepare('SELECT offer_json FROM attempts').get()?.offer_json))).not.toHaveProperty('note');}
  finally {raw.close();}
  const reopened=await f.open(path,{runtime:null});
  expect(await reopened.runs.execute(runCommand(revision.id,73,body))).toEqual(run);
  expect(await reopened.runs.getRun({scope,id:run.id})).toEqual(changed);
});
it('rolls back all run admission records when initial note persistence fails', async () => {
  const path=f.path(); let metadata=await f.open(path,runOptions()); await seed(metadata);
  const revision=await append(metadata,await createSuite(metadata)); await f.close(metadata);
  const db=new DatabaseSync(path);
  db.exec("CREATE TRIGGER reject_initial_note BEFORE INSERT ON run_notes BEGIN SELECT RAISE(ABORT,'synthetic note failure'); END;"); db.close();
  metadata=await f.open(path,runOptions());
  const failedBody={...runRequest(revision.id),note:'Initial'};
  await expect(metadata.runs.execute(runCommand(revision.id,70,failedBody))).rejects.toBeDefined();
  expect((await metadata.runs.listRuns({scope,limit:100})).items).toEqual([]);
  await f.close(metadata);
  const verify=new DatabaseSync(path,{readOnly:true});
  try {for(const table of ['runs','attempts','run_notes','history_note_grams','dispatch_outbox'])
    expect(verify.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n).toBe(0);
    expect(verify.prepare('SELECT COUNT(*) n FROM receipts WHERE request_id=?').get(failedBody.requestId)?.n).toBe(0);
  } finally {verify.close();}
});
