import { describe,it,expect } from 'vitest';
import { evaluateRetentionWindow } from '../../src/domain/retention/index.js';
import type { RetentionFact,RetentionPrefix } from '../../src/domain/retention/index.js';
const now=Date.parse('2026-11-14T12:00:00.000Z');
const initial:RetentionPrefix={completedCount:0,logicalBytes:0};
const fact=(overrides:Partial<RetentionFact>={}):RetentionFact=>({requestedAt:'2026-11-13T12:00:00.000Z',completed:true,logicalBytes:10,protection:'none',...overrides});
describe('bounded retention rules',()=>{
 it('uses strict count/budget boundaries and includes the candidate in its prefix',()=>{
  const result=evaluateRetentionWindow({policy:{mode:'enabled',completedRunCount:1,storageBytes:20},prefix:initial,facts:[fact(),fact(),fact()],now});
  expect(result.decisions.map(v=>v.reason)).toEqual([null,'completed_count','completed_count']);
  expect(result.prefix).toEqual({completedCount:3,logicalBytes:30});
  expect(evaluateRetentionWindow({policy:{mode:'enabled',storageBytes:20},prefix:initial,facts:[fact(),fact(),fact()],now}).decisions.map(v=>v.reason)).toEqual([null,null,'storage_budget']);
 });
 it('protects active, pinned, unknown and already-cleaning work while counting completed protected debt',()=>{
  const result=evaluateRetentionWindow({policy:{mode:'enabled',ageDays:1,completedRunCount:1,storageBytes:1},prefix:initial,
   facts:[fact({completed:false,logicalBytes:null}),fact({protection:'pinned'}),fact({protection:'unknown'}),fact({protection:'cleanup_in_progress'}),fact()],now});
  expect(result.decisions).toEqual([{reason:null,excluded:'active'},{reason:null,excluded:'pinned'},{reason:null,excluded:'unknown'},{reason:null,excluded:'cleanup_in_progress'},{reason:'age',excluded:null}]);
  expect(result.prefix).toEqual({completedCount:4,logicalBytes:40});
 });
 it('propagates unknown byte debt instead of inventing spare storage, while independent count still works',()=>{
  const facts=[fact({protection:'unknown',logicalBytes:null}),fact()];
  expect(evaluateRetentionWindow({policy:{mode:'enabled',storageBytes:1},prefix:initial,facts,now}).decisions.map(v=>v.reason)).toEqual([null,null]);
  const result=evaluateRetentionWindow({policy:{mode:'enabled',completedRunCount:1,storageBytes:1},prefix:initial,facts,now});
  expect(result.prefix.logicalBytes).toBeNull();expect(result.decisions[1]?.reason).toBe('completed_count');
 });
 it('uses the exact age boundary, keeps future requests and manual policies',()=>{
  const facts=[fact({requestedAt:'2026-11-13T12:00:00.001Z'}),fact(),fact({requestedAt:'2026-11-15T12:00:00.000Z'})];
  expect(evaluateRetentionWindow({policy:{mode:'enabled',ageDays:1},prefix:initial,facts,now}).decisions.map(v=>v.reason)).toEqual([null,'age',null]);
  expect(evaluateRetentionWindow({policy:{mode:'manual'},prefix:initial,facts,now}).decisions.every(v=>v.reason===null)).toBe(true);
 });
 it('preserves decisions across bounded windows without mutating input',()=>{
  const facts=Array.from({length:100},()=>fact());const input={policy:{mode:'enabled' as const,completedRunCount:50},prefix:initial,facts,now};
  const before=JSON.stringify(input);const whole=evaluateRetentionWindow(input);
  const first=evaluateRetentionWindow({...input,facts:facts.slice(0,37)});const second=evaluateRetentionWindow({...input,prefix:first.prefix,facts:facts.slice(37)});
  expect([...first.decisions,...second.decisions]).toEqual(whole.decisions);expect(second.prefix).toEqual(whole.prefix);expect(JSON.stringify(input)).toBe(before);
 });
 it('rejects overflow, oversized windows, false dates and unknown debt without protection',()=>{
  const input={policy:{mode:'enabled' as const,ageDays:1},prefix:initial,facts:[fact()],now};
  for(const bad of [{...input,prefix:{completedCount:Number.MAX_SAFE_INTEGER,logicalBytes:0}},
   {...input,prefix:{completedCount:0,logicalBytes:Number.MAX_SAFE_INTEGER}}, {...input,facts:Array.from({length:101},()=>fact())},
   {...input,facts:[fact({requestedAt:'2026-02-31T12:00:00.000Z'})]}, {...input,facts:[fact({logicalBytes:null})]}])expect(()=>evaluateRetentionWindow(bad)).toThrow();
 });
});
