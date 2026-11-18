import {expect,it,vi} from 'vitest';
import {captureLiveMetricHistory} from '@beetle/contracts/api';
import type {ClientResult} from '@beetle/contracts';
import type {LiveMetricHistory} from '@beetle/contracts/api';
import data from '../../../contracts/fixtures/api/valid/live-metric-history.json' with {type:'json'};
import {createRunLiveHistoryService} from '../../src/application/run-live-history/index.js';
import {RunExecutions} from '../../src/adapters/outbound/sqlite/execution-binding/index.js';
import type {RunExecutionSnapshot,RunExecutionReader} from '../../src/ports/run-live-metrics.js';
import type {RunnerLiveHistoryGateway} from '../../src/ports/run-live-history.js';
import {fixture,keyFor,uuid} from '../run-results/fixture.js';
import {hash,deferred} from '../run-live-metrics/fixtures.js';
function setup(){const f=fixture();const key=keyFor(f.key.runId);const base=new RunExecutions(f.db,f.reads).get(key);
 const snapshot:RunExecutionSnapshot={...base,run:{...base.run,state:'active'}};const read=vi.fn<RunExecutionReader['getRunExecution']>(async()=>snapshot);
 const value=captureLiveMetricHistory(data,hash);const {organizationId,workspaceId,attemptId,generation}=f.key.attempt;value.scope={organizationId,workspaceId,attemptId,generation};value.prefix.scope={...value.scope};
 const remote=vi.fn<RunnerLiveHistoryGateway['liveHistory']>(async()=>({ok:true,value}));const service=createRunLiveHistoryService({executions:{getRunExecution:read},gateway:{liveHistory:remote},hash});
 return {snapshot,read,value,remote,service,query:{...key,attemptId:f.key.attempt.attemptId},context:()=>({signal:new AbortController().signal,deadline:performance.now()+30000})};}
it('captures and rechecks the exact scoped physical binding around one remote bootstrap',async()=>{
 const e=setup();expect(await e.service.reader.getRunLiveHistory(e.query,e.context())).toEqual(e.value);expect(e.read).toHaveBeenCalledTimes(2);expect(e.remote).toHaveBeenCalledTimes(1);
 expect(e.remote.mock.calls[0]![0]).toEqual({...e.snapshot.binding!.key.attempt,journalAuthority:e.snapshot.binding!.journalAuthority});await e.service.close();
});
it.each(['scope','attempt','terminal','unbound','cancelled'] as const)('refuses unsafe initial %s without remote effects',async kind=>{
 const e=setup();let current=structuredClone(e.snapshot);if(kind==='scope')current.run.scope.workspaceId=uuid(999);if(kind==='attempt')current.run.activeAttemptId=uuid(999);if(kind==='terminal')current.run.state='finished';if(kind==='unbound')current={...current,binding:null};if(kind==='cancelled')current.run.cancellationRequested=true;e.read.mockResolvedValue(current);
 await expect(e.service.reader.getRunLiveHistory(e.query,e.context())).rejects.toThrow();expect(e.remote).not.toHaveBeenCalled();await e.service.close();
});
it.each(['terminal','journal'] as const)('rejects a history reply after %s authority changes',async kind=>{
 const e=setup();let after=structuredClone(e.snapshot);if(kind==='terminal')after.run.state='finished';else after={...after,binding:{...after.binding!,journalAuthority:uuid(999)}};
 e.read.mockResolvedValueOnce(e.snapshot).mockResolvedValueOnce(after);await expect(e.service.reader.getRunLiveHistory(e.query,e.context())).rejects.toThrow();await e.service.close();
});
it('retains its one original after caller abort and drains it before shutdown',async()=>{
 const e=setup();const gate=deferred<ClientResult<LiveMetricHistory>>();e.remote.mockImplementation(()=>gate.promise);const abort=new AbortController();const result=e.service.reader.getRunLiveHistory(e.query,{...e.context(),signal:abort.signal});const rejected=expect(result).rejects.toThrow();
 await expect.poll(()=>e.remote.mock.calls.length).toBe(1);abort.abort();await rejected;await expect(e.service.reader.getRunLiveHistory(e.query,e.context())).rejects.toMatchObject({code:'busy'});
 let closed=false;const closing=e.service.close().then(()=>{closed=true});await new Promise(resolve=>setImmediate(resolve));expect(closed).toBe(false);gate.resolve({ok:true,value:e.value});await closing;expect(e.read).toHaveBeenCalledTimes(1);
});
