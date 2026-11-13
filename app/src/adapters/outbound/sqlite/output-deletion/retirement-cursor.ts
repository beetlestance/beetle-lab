import { requireRule } from '../../../../domain/namespaces/index.js';
import { natural,uuid } from './values.js';
import type { OutputDeletionScan } from '../../../../ports/output-deletion-metadata.js';
import { StorageError } from '../protocol.js';
export interface RetirementPosition {readonly installationId:string;readonly upper:number;readonly after:number}
export function retirementCursor(value:RetirementPosition,limit:number):string{
 return Buffer.from(JSON.stringify(['output-retirement-v1',value.installationId,limit,value.upper,value.after])).toString('base64url');
}
export function retirementPosition(query:OutputDeletionScan):RetirementPosition|undefined{
 if(query.cursor===undefined)return undefined;
 try{
  if(query.cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw Error('Invalid cursor');
  const position=decode(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')) as unknown,query.limit);
  if(retirementCursor(position,query.limit)!==query.cursor)throw Error('Noncanonical cursor');return position;
 }catch{throw new StorageError('invalid_input');}
}

function decode(input:unknown,limit:number):RetirementPosition{
 natural(limit,32,1);requireRule(Array.isArray(input)&&input.length===5&&input[0]==='output-retirement-v1'&&input[2]===limit);
 const value=input as unknown[];const installationId=uuid(value[1]);const upper=value[3];const after=value[4];
 natural(upper,Number.MAX_SAFE_INTEGER,1);natural(after,Number.MAX_SAFE_INTEGER,1);requireRule(after<=upper);return {installationId,upper,after};
}
