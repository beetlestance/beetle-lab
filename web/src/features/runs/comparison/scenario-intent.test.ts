import { expect, it } from 'vitest';
import { scenarioFact } from './scenario-intent.js';
import { snapshot } from './fixtures.js';
it('preserves source rate units and marks allocation as configured intent',()=>{
 const item=snapshot().items[0]!;item.scenarioIntents=[{id:'main',executor:'constant-arrival-rate',arrivalRate:{initial:1200,maximum:1200,timeUnit:'2s'},vus:{initial:240,maximum:480}}];
 expect(scenarioFact(item,'executor')).toBe('Constant arrival rate');expect(scenarioFact(item,'arrival')).toBe('1,200 per 2s');expect(scenarioFact(item,'vus')).toBe('240 preallocated; 480 maximum');
 item.scenarioIntents.push({id:'vu-ramp',executor:'ramping-vus',arrivalRate:null,vus:{initial:0,maximum:24}});
 expect(scenarioFact(item,'arrival')).toContain('main: 1,200 per 2s; vu-ramp: Not an arrival-rate executor');expect(scenarioFact(item,'vus')).toContain('vu-ramp: Starts at 0; up to 24');
});
it('does not substitute observed or installed values for absent legacy intent',()=>{expect(scenarioFact(snapshot().items[0]!,'arrival')).toBe('Configuration intent unavailable')});
