import { expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { failureCodes, reportFailure } from './failure.js';

it('emits only bounded known causal codes, never messages, paths or stacks', () => {
  let error: Error = Object.assign(new Error('CANARY /private/secret.sql'), {code:'ENOSPC'});
  for (let index=0;index<8;index++) error=Object.assign(new Error('CANARY', {cause:error}), {code:'configuration'});
  expect(failureCodes(error)).toEqual(['configuration','configuration','configuration','configuration']);
  expect(failureCodes(Object.assign(new Error('CANARY'),{code:'CANARY'}))).toEqual(['unknown']);
  const sink=vi.spyOn(process.stderr,'write').mockImplementation(()=>true);
  try {
    reportFailure('startup_failed',error);
    expect(sink).toHaveBeenCalledOnce();
    const text=String(sink.mock.calls[0]?.[0]);expect(text).not.toMatch(/CANARY|private|secret/);
    expect(JSON.parse(text)).toEqual({component:'agent',event:'startup_failed',codes:failureCodes(error)});
  } finally {sink.mockRestore();}
});
it('bounds cycles and ignores accessor codes and causes',()=>{
  const getter=vi.fn(()=>{throw new Error('CANARY');});
  const error=Object.defineProperties(new Error('CANARY'),{code:{get:getter},cause:{get:getter}});
  expect(failureCodes(error)).toEqual(['unknown']);expect(getter).not.toHaveBeenCalled();
  const cycle=new Error('CANARY');Object.defineProperty(cycle,'cause',{value:cycle});
  expect(failureCodes(cycle)).toEqual(['unknown']);expect(failureCodes(null)).toEqual(['unknown']);
});
it('does not let a throwing diagnostic sink prevent failure handling',()=>{
  const sink=vi.spyOn(process.stderr,'write').mockImplementation(()=>{throw new Error('broken sink');});
  try {expect(()=>reportFailure('shutdown_failed',new Error('CANARY'))).not.toThrow();}
  finally {sink.mockRestore();}
});
it('wires a real startup failure through the executable without exposing supplied paths',async()=>{
  const execute=promisify(execFile);
  let failure:unknown;
  try {
    await execute(process.execPath,['--import','tsx','agent/src/bootstrap/main.ts'],{
      env:{PATH:process.env.PATH,NODE_NO_WARNINGS:'1',BEETLE_CONFIG_FILE:'/CANARY/private/config',
        BEETLE_AGENT_CONFIG_FILE:'/CANARY/private/agent',BEETLE_DATA_DIR:'/CANARY/private/data',
        BEETLE_EXTERNAL_ORIGIN:'http://127.0.0.1:4310'},timeout:15000,maxBuffer:8192,
    });
  } catch(error) {failure=error;}
  expect(failure).toMatchObject({code:1,stdout:''});
  const stderr=(failure as Error & {stderr:string}).stderr;
  expect(stderr).not.toContain('CANARY');
  const lines=stderr.split('\n').filter(line=>line.startsWith('{'));
  expect(lines.map(line=>JSON.parse(line))).toContainEqual(expect.objectContaining({component:'agent',event:'startup_failed'}));
},20000);
