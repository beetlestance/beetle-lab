import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import type {BigIntStats} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {ProvisionError} from '../types.js';
import type {ComposeHome} from './home.js';
function safe(value:unknown):asserts value{if(!value)throw new ProvisionError('recovery_required');}
/** Configuration serialization only; this gate never substitutes for Journal authority. */
export class ComposeGate {
 private db:DatabaseSync|undefined;
 private file:FileHandle|undefined;
 private info:BigIntStats|undefined;
 private installationId:unknown;
 constructor(private readonly home:Pick<ComposeHome,'path'|'assertPins'>,private readonly identity:{uid:number;gid:number}){}
 async open(fresh:boolean,requestDigest:string):Promise<void>{
  const path=join(this.home.path,'bootstrap.sqlite');await this.home.assertPins(true);
  const file=await open(path,constants.O_RDWR|constants.O_NOFOLLOW|(fresh?constants.O_CREAT|constants.O_EXCL:0),0o600);this.file=file;
  const info=await file.stat({bigint:true});this.info=info;
  this.fileCustody(info);
  await this.assertPin();this.db=new DatabaseSync(path,{timeout:100});await this.assertPin();
  this.db.exec('PRAGMA trusted_schema=OFF;PRAGMA synchronous=FULL;');
  const mode=this.db.prepare('PRAGMA journal_mode').get()?.journal_mode;safe(mode==='delete');
  if(fresh){this.db.exec("CREATE TABLE bootstrap(version INTEGER PRIMARY KEY CHECK(version=1),phase TEXT NOT NULL CHECK(phase IN ('preparing','ready')),request_digest TEXT NOT NULL,installation_id TEXT);PRAGMA user_version=1;");
   this.db.prepare("INSERT INTO bootstrap VALUES(1,'preparing',?,NULL)").run(requestDigest);await file.sync();
  }
  try{this.db.exec('BEGIN EXCLUSIVE');}catch(cause){throw new ProvisionError('conflict',{cause});}
  safe(this.db.prepare('PRAGMA user_version').get()?.user_version===1);
  const rows=this.db.prepare('SELECT version,phase,request_digest,installation_id FROM bootstrap LIMIT 2').all();safe(rows.length===1&&rows[0]!.version===1&&rows[0]!.request_digest===requestDigest);
  safe(rows[0]!.phase===(fresh?'preparing':'ready'));this.installationId=rows[0]!.installation_id;await this.assertPin();
 }
 matchInstallation(id:string):void{safe(this.installationId===id);}
 private fileCustody(info:BigIntStats):void{
  safe(info.isFile()&&info.nlink===1n&&info.uid===BigInt(this.identity.uid)&&info.gid===BigInt(this.identity.gid)&&(info.mode&0o777n)===0o600n&&info.size<=1048576n);
 }
 async ready(installationId:string):Promise<void>{
  await this.assertPin();safe(this.db);this.db.prepare("UPDATE bootstrap SET phase='ready',installation_id=? WHERE version=1 AND phase='preparing'").run(installationId);
 }
 async assertPin():Promise<void>{
  await this.home.assertPins(true);safe(this.info&&this.file);const actual=await lstat(join(this.home.path,'bootstrap.sqlite'),{bigint:true});
  safe(actual.dev===this.info.dev&&actual.ino===this.info.ino&&actual.nlink===1n&&actual.uid===BigInt(this.identity.uid)&&actual.gid===BigInt(this.identity.gid)&&(actual.mode&0o777n)===0o600n);
 }
 async close(success:boolean):Promise<void>{
  let failure=false;
  if(this.db){try{if(this.db.isTransaction)this.db.exec(success?'COMMIT':'ROLLBACK');this.db.close();}catch{failure=true;}}
  if(this.file){try{await this.file.close();}catch{failure=true;}}
  if(failure)throw new ProvisionError('cleanup');
 }
}
