import { createHash } from 'node:crypto';
import { readFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { exportExpectation,verifyStandaloneExportResultSeal } from '@beetle/contracts';
import { runStagedExport } from '../../../../engines/k6/wrapper/export/index.js';
import { collectOutputs } from '../../../../agent/src/collection/output/index.js';
import * as build from '../../../../engines/k6/build/index.js';
import { exportFixture } from './fixture.js';
const fixture=exportFixture();const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
afterEach(()=>vi.restoreAllMocks());
it('runs actual staged compiler/build/publication and shared native output custody without a load process',async()=>{
  const f=await fixture();const receipt=await runStagedExport(f.options);expect(receipt.ok).toBe(true);if(!receipt.ok)throw new Error(receipt.reason);
  const control=await readFile(join(f.root,'control.ndjson'));expect(control.byteLength).toBeLessThanOrEqual(65536);
  const events=control.toString('utf8').trim().split('\n').map(line=>JSON.parse(line) as {kind:string;phase:string});
  expect(events.filter(event=>event.kind==='export.result')).toHaveLength(1);
  expect(events.some(event=>['engine.result','case.result'].includes(event.kind)||event.phase==='execute')).toBe(false);
  expect(events.at(-1)?.kind).toBe('phase.finished');
  const raw=await readFile(join(f.root,'export-result.json'));expect(raw.byteLength).toBeLessThanOrEqual(8192);
  expect(verifyStandaloneExportResultSeal(JSON.parse(raw.toString('utf8')),hash)).toMatchObject({ok:true,value:receipt.result});
  const offer=f.assignment.offer;const key={organizationId:offer.organizationId,workspaceId:offer.workspaceId,attemptId:offer.attemptId,generation:1};
  const collected=collectOutputs({directory:f.root,uid:process.getuid!(),key,engineId:'k6',reportedResult:receipt.result,
    expectedExport:exportExpectation(f.assignment,hash),controlBytes:control.byteLength,outputBytes:offer.budget.outputBytes,deadline:performance.now()+5000});
  expect(await collected.result).toMatchObject({ok:true,value:receipt.result});await collected.quiesced;await collected.close();
  await expect(stat(join(f.root,'engine-result.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('rejects a different trusted runtime assignment pin before builder effects',async()=>{
  const f=await fixture();const spy=vi.spyOn(build,'buildRuntimeScript');
  const receipt=await runStagedExport({...f.options,exportAssignment:{purpose:'standalone_export',assignmentDigest:'d'.repeat(64)}});
  expect(receipt).toEqual({ok:false,reason:'input'});expect(spy).not.toHaveBeenCalled();
  await expect(stat(join(f.root,'control.ndjson'))).rejects.toMatchObject({code:'ENOENT'});
});
it('preserves pre-start cancellation and does not publish an invented terminal result',async()=>{
  const f=await fixture();f.controller.abort();expect(await runStagedExport(f.options)).toEqual({ok:false,reason:'cancelled'});
  await expect(stat(join(f.root,'export-result.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('retains known original build failure without exposing exception or fabricating success',async()=>{
  const f=await fixture();vi.spyOn(build,'buildRuntimeScript').mockRejectedValue(new Error('private canary'));
  const receipt=await runStagedExport(f.options);expect(receipt).toEqual({ok:false,reason:'generation'});
  await expect(stat(join(f.root,'export-result.json'))).rejects.toMatchObject({code:'ENOENT'});
});

it('captures trusted assignment and installed profile scalars before asynchronous native IO',async()=>{
  const f=await fixture();const options={...f.options,exportAssignment:{...f.options.exportAssignment!},installed:{...f.options.installed}};
  const pending=runStagedExport(options);options.exportAssignment.assignmentDigest='a'.repeat(64);
  options.installed.version='changed';options.outputRoot=join(f.root,'changed');
  expect((await pending).ok).toBe(true);expect((await stat(join(f.root,'export-result.json'))).isFile()).toBe(true);
  await expect(stat(join(f.root,'changed'))).rejects.toMatchObject({code:'ENOENT'});
});
