import {expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {Settings} from '../../src/adapters/outbound/sqlite/settings.js';
import * as rows from '../../src/adapters/outbound/sqlite/settings-row.js';
import {initialize} from '../../src/adapters/outbound/sqlite/schema.js';
import {requestId,seed,settingsCommand,settingsFixture,storageFixture,uuid} from './fixture.js';
const fixture=storageFixture();
const scope={kind:'organization' as const,organizationId:uuid(1)};
it('refuses a malformed scoped settings identity stored in an otherwise valid SQLite row',async()=>{
 const path=fixture.path();const first=await fixture.open(path);await seed(first);await fixture.close(first);
 const db=initialize(path);
 try {db.prepare("UPDATE settings SET id='not-a-uuid' WHERE kind='organization'").run();}finally{db.close();}
 const reopened=await fixture.open(path);
 await expect(reopened.getSettingsIdentity(scope)).rejects.toMatchObject({code:'unavailable'});
});

it.each(['unsafe-version','unknown-value','invalid-json','scalar-value','blob-value'])(
 'rejects %s while retaining independently valid identity reads',async kind=>{
  const path=fixture.path();const first=await fixture.open(path);await seed(first);
  const identity=await first.getSettingsIdentity(scope);await fixture.close(first);
  const db=initialize(path);
  try {
   if(kind==='unsafe-version')db.prepare("UPDATE settings SET version=? WHERE kind='organization'").run(9007199254740992);
   else {
    const payload=kind==='unknown-value'?'{}\n':kind==='invalid-json'?'invalid':kind==='scalar-value'?'null':Buffer.from('{}');
    const value=kind==='unknown-value'?'{"unknown":"CANARY"}':payload;
    db.prepare("UPDATE settings SET value_json=? WHERE kind='organization'").run(value);
   }
  }finally{db.close();}
  const reopened=await fixture.open(path);
  expect(await reopened.getSettingsIdentity(scope)).toEqual(identity);
  await expect(reopened.getSettings(scope)).rejects.toMatchObject({code:'unavailable'});
 });
it('replays an original settings receipt without reading corrupted defaults or refreshing runtime',async()=>{
 const path=fixture.path();const first=await fixture.open(path);await seed(first);
 const identity=await first.getSettingsIdentity(scope);
 const command=settingsCommand(identity.id,{scope,schemaVersion:2,requestId:requestId(),expectedVersion:1,
  patch:{retention:{mode:'manual'}}});
 const original=await first.settings.execute(command);await fixture.close(first);
 const db=initialize(path);
 try{db.prepare("UPDATE settings SET value_json='invalid' WHERE kind='organization'").run();}finally{db.close();}
 const reopened=await fixture.open(path,{runtime:null});
 expect(await reopened.getSettingsIdentity(scope)).toEqual(identity);
 expect(await reopened.settings.execute(command)).toEqual(original);
});

it('refuses a structurally valid identity belonging to a different requested scope',()=>{
 expect(()=>rows.captureSettingsIdentity({id:uuid(10),kind:'organization',organization_id:uuid(2),workspace_id:null},scope))
  .toThrowError(expect.objectContaining({code:'unavailable'}));
});
it('does not materialize oversized UTF-8 defaults across the SQLite projection boundary',()=>{
 // A task-only minimal table models damaged legacy input; no production guards are disabled.
 const db=new DatabaseSync(':memory:');
 const capture=vi.spyOn(rows,'captureSettingsRecord');
 try {
  db.exec('CREATE TABLE settings(scope_key TEXT,id TEXT,kind TEXT,organization_id TEXT,workspace_id TEXT,version INTEGER,value_json TEXT)');
  const fixture=settingsFixture();const settings=new Settings(db,{installation:fixture.chain.installation,runtime:null});
  const oversized=JSON.stringify({note:'🪲'.repeat(8192)});
  expect(oversized.length).toBeLessThan(32768);expect(Buffer.byteLength(oversized)).toBeGreaterThan(32768);
  db.prepare("UPDATE settings SET value_json=? WHERE scope_key='installation'").run(oversized);
  expect(()=>settings.get({kind:'installation'})).toThrowError(expect.objectContaining({code:'unavailable'}));
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({value_json:null}),{kind:'installation'});
 }finally{capture.mockRestore();db.close();}
});
