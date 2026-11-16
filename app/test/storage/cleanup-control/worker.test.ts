import { expect,it } from 'vitest';
import { storageFixture } from '../fixture.js';
import { ready,begin } from '../../output-deletion/fixture.js';
import { asSchema20 } from './legacy020.js';
const storage=storageFixture();
it('requires an explicit committed legacy top-up before file reads and replays it after worker reopen',async()=>{
 const f=ready();const {key}=begin(f);asSchema20(f.db);const old=f.usage();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);
 let metadata=await storage.open(path,{runtime:null,runs:f.config});
 await expect(metadata.outputDeletions.getFile({...key,ordinal:0})).rejects.toMatchObject({code:'capacity_unavailable'});
 expect((await metadata.inputs.storage()).chargedBytes).toBe(old);
 const summary=await metadata.outputDeletions.reserveControl(key);expect(summary.stage).toBe('pending');expect((await metadata.inputs.storage()).chargedBytes).toBe(old+65536);
 const first=await metadata.outputDeletions.getFile({...key,ordinal:0});await storage.close(metadata);metadata=await storage.open(path,{runtime:null,runs:f.config});
 expect(await metadata.outputDeletions.reserveControl(key)).toEqual(summary);expect(await metadata.outputDeletions.getFile({...key,ordinal:0})).toEqual(first);expect((await metadata.inputs.storage()).chargedBytes).toBe(old+65536);
});

it('keeps unreserved legacy work charged and unreadable when top-up is one byte short',async()=>{
 const f=ready();const {key}=begin(f);asSchema20(f.db);const old=f.usage();
 const row=f.db.prepare("SELECT value_json FROM settings WHERE scope_key='installation'").get()!;const values=JSON.parse(String(row.value_json)) as {pool:{storageBytes:number;freeSpaceReserveBytes:number}};
 values.pool.storageBytes=old+65536+values.pool.freeSpaceReserveBytes-1;f.db.prepare("UPDATE settings SET value_json=? WHERE scope_key='installation'").run(JSON.stringify(values));
 const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const metadata=await storage.open(path,{runtime:null,runs:f.config});
 await expect(metadata.outputDeletions.reserveControl(key)).rejects.toMatchObject({code:'capacity_unavailable'});
 await expect(metadata.outputDeletions.getFile({...key,ordinal:0})).rejects.toMatchObject({code:'capacity_unavailable'});
 expect((await metadata.inputs.storage()).chargedBytes).toBe(old);expect(await metadata.outputDeletions.get(key)).toMatchObject({stage:'pending',version:1});
});
