import { expect, it, vi } from 'vitest';
import {captureReleaseAuthority} from './authority.js';
import {readReleaseAuthority} from './github.js';
function fixture() {
  return {environment: {name:'beetle-release', protection_rules:[{type:'required_reviewers',
    reviewers:[{type:'User',reviewer:{id:123}}]}],
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}},
    branches:{total_count:1,branch_policies:[{name:'rewrite/integration',type:'branch'}]}};
}
it('accepts configured reviewer approval confined to the exact integration branch',()=>{
  const f=fixture();expect(()=>captureReleaseAuthority(f.environment,f.branches)).not.toThrow();
});
it.each(['implicit','no-reviewer','bad-reviewer','wrong-name','open-branches','wildcard','extra-branch','tag','incomplete'])(
 'refuses %s release authority',kind=>{
  const f=fixture();
  switch(kind){
   case 'implicit':f.environment.protection_rules=[];break;
   case 'no-reviewer':f.environment.protection_rules[0]!.reviewers=[];break;
   case 'bad-reviewer':f.environment.protection_rules[0]!.reviewers[0]!.reviewer.id=0;break;
   case 'wrong-name':f.environment.name='other';break;
   case 'open-branches':f.environment.deployment_branch_policy.custom_branch_policies=false;break;
   case 'wildcard':f.branches.branch_policies[0]!.name='*';break;
   case 'extra-branch':f.branches.branch_policies.push({name:'main',type:'branch'});f.branches.total_count=2;break;
   case 'tag':f.branches.branch_policies[0]!.type='tag';break;
   case 'incomplete':f.branches.total_count=2;break;
  }
  expect(()=>captureReleaseAuthority(f.environment,f.branches)).toThrow();
 });
it('reads only fixed metadata endpoints and grants no publication capability',async()=>{
 const f=fixture();const api=vi.fn(async(path:string)=>path.endsWith('beetle-release')?f.environment:f.branches);
 await readReleaseAuthority(api);
 expect(api.mock.calls.map(([path])=>path)).toEqual([
  'repos/beetlestance/beetle-lab/environments/beetle-release',
  'repos/beetlestance/beetle-lab/environments/beetle-release/deployment-branch-policies?per_page=100',
 ]);
});
it('joins all issued reads before failing without exposing API error text',async()=>{
 let finish:(value:unknown)=>void=()=>undefined;const delayed=new Promise<unknown>(resolve=>{finish=resolve;});
 const api=vi.fn((path:string)=>path.endsWith('beetle-release')?Promise.reject(new Error('CANARY')):delayed);
 const pending=readReleaseAuthority(api);const failed=vi.fn();void pending.catch(failed);
 await Promise.resolve();await Promise.resolve();expect(failed).not.toHaveBeenCalled();
 finish(fixture().branches);await expect(pending).rejects.toThrow('Release approval policy unavailable');
 expect(api).toHaveBeenCalledTimes(2);
});

it('refuses a missing release environment',()=>{
 const f=fixture();expect(()=>captureReleaseAuthority(null,f.branches)).toThrow();
});
