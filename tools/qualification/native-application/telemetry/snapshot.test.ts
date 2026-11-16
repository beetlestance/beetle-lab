import {expect,it} from 'vitest';
import {fixture} from './snapshot-fixture.js';
import {publicSnapshot} from './snapshot.js';
it('recomputes closed facts and omits paths, installation IDs and arbitrary private fields',()=>{
 const f=fixture();const report=publicSnapshot(f.input,f.component,f.expected);expect(report.comparison.targetMet).toBe(true);
 expect(report.externalHarnessUid).toBeNull();expect(publicSnapshot({...f.input,harnessUid:0},f.component,f.expected).externalHarnessUid).toBe(0);
 expect(()=>publicSnapshot({...f.input,harnessUid:-1},f.component,f.expected)).toThrow();
 expect(report.verified).toHaveLength(10);expect(report.verified[0]!.artifacts).toHaveLength(8);
 const json=JSON.stringify(report);for(const value of ['NEVER-PUBLIC','/Users/private',f.expected.installationId,f.component.results[0]!.runtimeId])expect(json).not.toContain(value);
});
it('rejects changed ownership, incomplete evidence, wrong resource scopes and invented summaries',()=>{
 const a=fixture();expect(()=>publicSnapshot(a.input,a.component,{...a.expected,installationId:'22222222-2222-4222-8222-222222222222'})).toThrow();
 const b=fixture();b.input.results.points[0]!.summedRssBytes=268435457;expect(()=>publicSnapshot(b.input,b.component,b.expected)).toThrow();
 const c=fixture();c.component.results[1]!.subscribers[0]!.frames=1;expect(()=>publicSnapshot(c.input,c.component,c.expected)).toThrow();
 const d=fixture();d.input.results.comparison.additionalWallPercent=0;expect(()=>publicSnapshot(d.input,d.component,d.expected)).toThrow();
 const e=fixture();e.component.results[0]!.final.artifacts.pop();expect(()=>publicSnapshot(e.input,e.component,e.expected)).toThrow();
});
