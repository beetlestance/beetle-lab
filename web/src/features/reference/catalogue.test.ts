import {expect,it} from 'vitest';
import {apiMessageSchemas} from '@beetle/contracts/api';
import {schemaText,filterOperations} from './catalogue.js';
it('resolves every shipped public message definition without fetching external references',()=>{
 for(const name of Object.keys(apiMessageSchemas) as (keyof typeof apiMessageSchemas)[]){
  const value=schemaText(name);expect(()=>JSON.parse(value.text)).not.toThrow();expect(new TextEncoder().encode(value.text).length).toBeLessThanOrEqual(262144);
 }
});
it('filters route/method/operation names with a bounded literal query',()=>{
 expect(filterOperations('POST /api/v2/organizations').items.every(row=>row.method==='POST')).toBe(true);
 expect(filterOperations('createExport').items.map(row=>row.name)).toEqual(['createExport']);
 expect(filterOperations('[').total).toBe(0);expect(filterOperations('x'.repeat(10000)).items).toEqual([]);
});
