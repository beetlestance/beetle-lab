import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { openAgentOwners } from '../../src/bootstrap/agent-owners.js';
import { outputOwnerFixture,deferred,flush } from './fixture.js';
const mocks=vi.hoisted(()=>({start:vi.fn()}));
vi.mock('../../src/adapters/outbound/runner/index.js',()=>({startDeliveryRuntime:mocks.start}));
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(10000);mocks.start.mockReset();});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('captures actual output availability and reports stopped before a held close joins',async()=>{
 const f=outputOwnerFixture(mocks.start);let broken=false;
 f.output.state=()=>{if(broken)throw Error('SYNTHETIC_PRIVATE_DRIVER_ERROR');return{status:'running',active:0,problem:null};};
 const runtime=await openAgentOwners(f);await flush();expect(runtime.cleanupState()).toBe('running');
 f.output.state=()=>({status:'failed',active:0,problem:'operation_failure'});expect(runtime.cleanupState()).toBe('running');
 broken=true;expect(runtime.cleanupState()).toBe('unknown');expect(f.output.close).not.toHaveBeenCalled();broken=false;
 const held=deferred<void>();vi.mocked(f.output.close).mockReturnValueOnce(held.promise);const closing=runtime.close();
 expect(runtime.cleanupState()).toBe('stopped');await flush();expect(f.gateway.close).not.toHaveBeenCalled();held.resolve();await closing;expect(f.gateway.close).toHaveBeenCalledOnce();
});
it('reports output failure before draining an outstanding close and does not turn it into completion',async()=>{
 const f=outputOwnerFixture(mocks.start);const runtime=await openAgentOwners(f);await flush();const held=deferred<void>();vi.mocked(f.output.close).mockReturnValueOnce(held.promise);
 const failure=Error('Synthetic cleanup failure');const notification=f.failOutput(failure);expect(runtime.cleanupState()).toBe('stopped');
 const closing=runtime.close();const outcome=closing.then(()=>true,()=>false);await notification;await flush();expect(f.gateway.close).not.toHaveBeenCalled();held.resolve();expect(await outcome).toBe(false);expect(runtime.cleanupState()).toBe('stopped');
});
it('reports disabled when no output driver was installed even if capacity is healthy',async()=>{
 const f=outputOwnerFixture(mocks.start);const {openOutputs,...options}=f;const runtime=await openAgentOwners(options);await flush();
 try{expect(runtime.cleanupState()).toBe('disabled');expect(openOutputs).not.toHaveBeenCalled();expect(f.output.close).not.toHaveBeenCalled();}finally{await runtime.close();}
});
