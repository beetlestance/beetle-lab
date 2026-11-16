import {expect,it} from 'vitest';
import type {AttemptSnapshot} from '@beetle/contracts';
import assignment from '../../../contracts/fixtures/export-v1/assignment.json' with {type:'json'};
import result from '../../../contracts/fixtures/export-v1/result.json' with {type:'json'};
import {mergeAttemptSnapshot} from '../../src/domain/attempt-observation/index.js';
import {mergeAttemptObservation} from '../../src/domain/runs/index.js';
const expected={organizationId:assignment.offer.organizationId,workspaceId:assignment.offer.workspaceId,attemptId:assignment.offer.attemptId,
 generation:1 as const,intentDigest:assignment.offer.intentDigest};
function snapshot():AttemptSnapshot{return {protocolVersion:'1.0',...expected,state:'exited',phase:'seal',lastSeq:10,retainedStartSeq:1,
 cancelRequested:false,exportResult:structuredClone(result) as NonNullable<AttemptSnapshot['exportResult']>};}
it('retains exact export witnesses through late replies without projecting a performance Run',()=>{
 const original=snapshot();const older={...snapshot(),lastSeq:9,cancelRequested:true};
 const merged=mergeAttemptSnapshot({expected,previous:original,incoming:older});
 expect(merged.exportResult).toEqual(result);expect(merged.cancelRequested).toBe(true);expect(Object.isFrozen(merged)).toBe(true);
 expect(()=>mergeAttemptObservation({expected,previous:null,incoming:original})).toThrow();
});
it('rejects equal-sequence alteration, forward result erasure and nested export scope substitution',()=>{
 const previous=snapshot();const changed=snapshot();changed.exportResult!.assignmentDigest='f'.repeat(64);
 expect(()=>mergeAttemptSnapshot({expected,previous,incoming:changed})).toThrow();
 const {exportResult:unused,...missing}=snapshot();void unused;
 expect(()=>mergeAttemptSnapshot({expected,previous,incoming:{...missing,lastSeq:11}})).toThrow();
 const foreign=snapshot();foreign.exportResult!.workspaceId='00000000-0000-4000-8000-000000000099';
 expect(()=>mergeAttemptSnapshot({expected,previous:null,incoming:foreign})).toThrow();
});
