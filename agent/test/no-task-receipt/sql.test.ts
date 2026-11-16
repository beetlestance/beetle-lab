import { expect,it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { fundingFixture } from '../rejected-cleanup-funding/fixtures.js';
import { fundRejectedIntent } from '../../src/journal/rejected-controls/guard.js';
import { executeNoTaskReceipt } from '../../src/journal/no-task-receipts/store.js';
import { readInstalledNamespace } from '../../src/journal/staging-namespace/installed.js';
import { makeNoTaskReceipt,noTaskReceiptDigest } from '../../src/no-task-receipt-values/index.js';
import { transaction } from '../../src/journal/sql.js';
import { runtimeName } from '../../src/backends/docker/index.js';
const f=fundingFixture();
async function ready(second=false){
 const e=await f.native('cancel',second);transaction(e.db,()=>fundRejectedIntent(e.db,e.request));
 const installed=readInstalledNamespace(e.db);if(installed?.state!=='bound')throw Error('Missing fixture installation');
 const receipt=makeNoTaskReceipt({request:e.request,namespaceIdentity:installed.anchor.namespaceIdentity,
  taskName:runtimeName({...e.request,installationId:installed.intent.root.installationId}),daemonId:installed.intent.root.daemonId,
  root:installed.intent.root.native,markerDigest:installed.anchor.marker.sha256});
 const command={kind:'noTaskReceiptCommit' as const,id:1,json:JSON.stringify({request:e.request,receipt})};return{...e,receipt,command};
}
it('refuses raw insert/update/delete/replace while the fixed private metadata transaction is exact and idempotent',async()=>{
 const e=await ready();const json=encodeCanonicalJson(e.receipt,2048);const digest=noTaskReceiptDigest(e.receipt);
 expect(()=>e.db.prepare('INSERT INTO output_no_task_cleanup_receipts VALUES(?,?,?,?,?)').run(e.key.attemptId,e.receipt.retirementRequestDigest,digest,json,Buffer.byteLength(json)+512)).toThrow();
 const stored=executeNoTaskReceipt(e.db,e.command);expect(executeNoTaskReceipt(e.db,e.command)).toEqual(stored);
 expect(()=>e.db.exec('UPDATE output_no_task_cleanup_receipts SET receipt_json=receipt_json')).toThrow();
 expect(()=>e.db.exec('DELETE FROM output_no_task_cleanup_receipts')).toThrow();
 expect(()=>e.db.exec('INSERT OR REPLACE INTO output_no_task_cleanup_receipts SELECT * FROM output_no_task_cleanup_receipts')).toThrow();
 expect(e.db.prepare('SELECT original_count,charged_bytes FROM rejected_cleanup_storage').get()).toMatchObject({original_count:1,charged_bytes:16384});
 expect(e.db.prepare('SELECT count(*) n FROM disk_holds').get()?.n).toBe(0);expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each(['global','original','nested_funding'] as const)('rolls back a nested %s write without opening a second private permit',async kind=>{
 const e=await ready(true);if(kind==='nested_funding')e.db.function('synthetic_funding',()=>{fundRejectedIntent(e.db,e.secondRequest);return 1;});
 const body=kind==='global'?'UPDATE admission_settings SET observation_json=NULL;':kind==='original'?'UPDATE accepted_attempts SET cancel_requested=cancel_requested;':'SELECT synthetic_funding();';
 e.db.exec(`CREATE TRIGGER synthetic_attack AFTER INSERT ON output_no_task_cleanup_receipts BEGIN ${body} END;`);
 expect(()=>executeNoTaskReceipt(e.db,e.command)).toThrow();expect(e.db.prepare('SELECT count(*) n FROM output_no_task_cleanup_receipts').get()?.n).toBe(0);
 expect(e.db.prepare('SELECT original_count FROM rejected_cleanup_storage').get()?.original_count).toBe(1);
 e.db.exec('DROP TRIGGER synthetic_attack');expect(executeNoTaskReceipt(e.db,e.command)?.receipt).toEqual(e.receipt);
});
it('captures bounded exact worker commands before permitting a receipt write',async()=>{
 const e=await ready();for(const command of [{...e.command,extra:true},{...e.command,json:'x'.repeat(6145)},
  {...e.command,json:JSON.stringify({request:e.request,receipt:e.receipt,extra:true})},{...e.command,id:0}]){
  expect(()=>executeNoTaskReceipt(e.db,command)).toThrow('invalid_input');
 }
 expect(e.db.prepare('SELECT count(*) n FROM output_no_task_cleanup_receipts').get()?.n).toBe(0);
});
