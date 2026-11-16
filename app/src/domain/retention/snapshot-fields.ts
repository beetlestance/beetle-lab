import { validateApi } from '@beetle/contracts/api';
import { requireRule } from '../namespaces/index.js';
import type { RetentionPrefix } from './rule-types.js';
export function closed(value:unknown,names:readonly string[]):asserts value is Record<string,unknown>{
 requireRule(value!==null&&typeof value==='object'&&!Array.isArray(value));
 requireRule(Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)));
}
export function natural(value:unknown,maximum=Number.MAX_SAFE_INTEGER,minimum=0):asserts value is number{
 requireRule(typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=minimum&&value<=maximum);
}
export function uuid(value:unknown):string{requireRule(validateApi('Uuid',value).ok);return(value as string).toLowerCase();}
export function timestamp(value:unknown):string{
 requireRule(typeof value==='string'&&value.length===24&&validateApi('RunTimestamp',value).ok);
 const parsed=Date.parse(value);requireRule(Number.isFinite(parsed)&&new Date(parsed).toISOString()===value);return value;
}
export function prefix(value:unknown):RetentionPrefix{
 closed(value,['completedCount','logicalBytes']);natural(value.completedCount);if(value.logicalBytes!==null)natural(value.logicalBytes);
 return{completedCount:value.completedCount,logicalBytes:value.logicalBytes};
}
export function nullableUuid(value:unknown):string|null{return value===null?null:uuid(value);}
