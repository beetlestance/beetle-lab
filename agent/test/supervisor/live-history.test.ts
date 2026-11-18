import {expect,it,vi} from 'vitest';
import type {PrefixRead,PrefixHistory,PrefixReadOptions} from '../../src/collection/live-history/index.js';
import {Supervisor} from '../../src/supervisor/index.js';
import type {HistoryReader} from '../../src/supervisor/index.js';
import type {MailboxArchiveReply,Operation} from '../../src/backends/docker/index.js';
import {frame,image} from '../live-metrics/fixtures.js';
import {ControlledBackend,deferred,installationId,supervisorFixture} from './fixtures.js';
const fixture=supervisorFixture();
async function setup(){
 const e=await fixture.setup();const backend=new ControlledBackend();const end=e.time.wall();
 const value=frame({scope:e.input.key,capturedAtMs:end,publishedAtMs:end,startTimeMs:end-1000,endTimeMs:end});
 value.archivePrefix={scope:e.input.key,windows:1,endTimeMs:end,
 data:{artifactId:'00000000-0000-4000-8000-000000000005',relativePath:'metric-windows.ndjson',bytes:2048,sha256:'a'.repeat(64)},
 index:{artifactId:'00000000-0000-4000-8000-000000000006',relativePath:'metric-index.ndjson',bytes:1024,sha256:'b'.repeat(64)}};
 const readMailbox=vi.fn(async():Promise<MailboxArchiveReply>=>({ok:true,status:200,image:image(value)}));
 const native=vi.fn<HistoryReader>((options)=>({result:Promise.resolve({ok:true,value:history(options)}),quiesced:Promise.resolve(),close:async()=>{}}));
 const manager=new Supervisor({journal:e.journal,installationId,clock:e.time,backendFactory:()=>Object.assign(backend,{readMailbox}),liveMetricApproval:()=>({scope:value.scope,producerEpoch:value.producerEpoch,subset:value.subset}),liveHistoryReader:native});
 return {...e,manager,backend,readMailbox,native,value,operation:():Operation=>({deadline:e.time.monotonic()+30000})};
}
function history(options:PrefixReadOptions):PrefixHistory{return {prefix:options.frame.archivePrefix!,scope:options.scope,producerEpoch:options.frame.producerEpoch,subset:options.frame.subset,sampled:false,samples:[]};}
it('uses only an existing running owner and its approved mailbox frame, without starting another execution',async()=>{
 const e=await setup();expect(await e.manager.readLiveHistory(e.input.key,e.operation())).toEqual({ok:false,reason:'unavailable'});expect(e.manager.size).toBe(0);
 const actor=e.manager.actor(e.input);await actor.launch();await actor.tick();
 expect(await e.manager.readLiveHistory(e.input.key,e.operation())).toMatchObject({ok:true,value:{scope:e.input.key}});
 expect(e.native).toHaveBeenCalledTimes(1);expect(e.native.mock.calls[0]![0].frame).toEqual(e.value);
 const mount=e.input.plan.spec.HostConfig.Mounts.find(x=>x.Target==='/beetle/output')!;expect(e.native.mock.calls[0]![0].directory).toBe(mount.Source);
 expect(e.backend.starts).toBe(1);expect(await e.manager.readLiveHistory({...e.input.key,generation:2},e.operation())).toEqual({ok:false,reason:'unavailable'});await e.manager.closeTelemetry();
});
it('keeps a history original and retirement blocked after an early failed result until native quiescence',async()=>{
 const e=await setup();const actor=e.manager.actor(e.input);await actor.launch();const quiet=deferred<void>();let signal:AbortSignal|undefined;
 e.native.mockImplementation(options=>{signal=options.signal;return {result:Promise.resolve({ok:false,reason:'deadline'}),quiesced:quiet.promise,close:async()=>{}};});
 const read=actor.readLiveHistory(e.operation());await expect.poll(()=>e.native.mock.calls.length).toBe(1);
 expect(await actor.readLiveHistory(e.operation())).toEqual({ok:false,reason:'busy'});expect(()=>e.manager.retire(e.input)).toThrow('conflict');
 let closed=false;const closing=e.manager.closeTelemetry().then(()=>{closed=true});await Promise.resolve();expect(signal?.aborted).toBe(true);expect(closed).toBe(false);
 quiet.resolve();expect(await read).toEqual({ok:false,reason:'closed'});await closing;e.manager.retire(e.input);
});
it('keeps control cancellation independent and refuses a late native history result',async()=>{
 const e=await setup();const actor=e.manager.actor(e.input);await actor.launch();const gate=deferred<Awaited<PrefixRead['result']>>();let options!:PrefixReadOptions;
 e.native.mockImplementation(value=>{options=value;return {result:gate.promise,quiesced:Promise.resolve(),close:async()=>{}};});
 const read=actor.readLiveHistory(e.operation());await expect.poll(()=>e.native.mock.calls.length).toBe(1);await actor.cancel();expect(e.backend.stops).toHaveLength(1);
 gate.resolve({ok:true,value:history(options)});expect(await read).toEqual({ok:false,reason:'closed'});await e.manager.closeTelemetry();
});
it('retains failed native-close ownership and refuses positive retirement',async()=>{
 const e=await setup();const actor=e.manager.actor(e.input);await actor.launch();e.native.mockImplementation(options=>({result:Promise.resolve({ok:true,value:history(options)}),quiesced:Promise.resolve(),close:async()=>{throw Error('Synthetic failed close');}}));
 expect(await actor.readLiveHistory(e.operation())).toEqual({ok:false,reason:'unavailable'});expect(()=>e.manager.retire(e.input)).toThrow('conflict');
 await expect(e.manager.closeTelemetry()).rejects.toThrow('journal_unavailable');
});
it('does not open native files when a frame has no completed prefix',async()=>{
 const e=await setup();delete e.value.archivePrefix;const actor=e.manager.actor(e.input);await actor.launch();expect(await actor.readLiveHistory(e.operation())).toEqual({ok:false,reason:'unavailable'});expect(e.native).not.toHaveBeenCalled();await e.manager.closeTelemetry();
});
