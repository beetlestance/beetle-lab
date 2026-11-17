import {generationDigest} from '@beetle/contracts/installation-generation';
import {digest} from '../src/capture.js';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { build } from 'tsup';
import { mkdtemp, rm, chmod, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeDatabase } from '../../recovery/offline.js';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { fixture, agentId, engineId } from './fixtures.js';
import { provisionFreshInstallation } from '../index.js';
import { starterExport } from '../starter/export.js';
import { changeInstalledMemory, changeInstalledCapacity } from '../capacity/index.js';
import { configurationStatePath } from '../src/configuration.js';
import { native } from '../src/files.js';
import { openMetadata } from '../../../app/src/adapters/outbound/sqlite/index.js';
import { loadAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import type { DockerRequest, DockerReply } from '../../../agent/src/backends/docker/index.js';
const f = fixture(); let worker: URL; let bundle: string;
const operationId = '00000000-0000-4000-8000-000000000099';
beforeAll(async () => {
  bundle = await mkdtemp(join(tmpdir(), 'beetle-capacity-worker-'));
  await build({entry:['app/src/adapters/outbound/sqlite/worker.ts'], outDir:bundle, format:['esm'], platform:'node',
    target:'node24', bundle:true, noExternal:[/.*/], shims:true, removeNodeProtocol:false, splitting:false, silent:true});
  worker = pathToFileURL(join(bundle,'worker.js'));
}, 20000);
afterAll(async () => {if(bundle)await rm(bundle,{recursive:true,force:true});});
afterEach(() => vi.restoreAllMocks());
async function setup(withExport = false) {
  const e = await f.setup();
  const request = withExport ? {...e.request, exportEngine:starterExport(e.request.engine,'synthetic-export:v1')} : e.request;
  const exportPin = 'sha256:'+'f'.repeat(64);
  const provisionDocker:typeof e.context.docker = {async request(input){
    const reply=await e.context.docker.request(input);
    return input.path.includes('synthetic-export') && reply.ok
      ? {...reply,body:{...(reply.body as Record<string,unknown>),Id:exportPin}} : reply;
  }};
  const installed = await provisionFreshInstallation(request,{...e.context,docker:provisionDocker});
  const record = JSON.parse(await readFile(installed.paths.installation,'utf8'));
  const path = join(installed.paths.backendData,'metadata.sqlite');
  const metadata = await openMetadata({path, workerUrl:worker, installation:record, runtime:null}); await metadata.close();
  await chmod(path,0o600); await writeFile(join(installed.paths.backendData,'history-canary'),'keep',{mode:0o600});
  let running = false; let agentPin = agentId; let enginePin = engineId; let actualAgent = agentId;
  const docker = {async request(input: DockerRequest): Promise<DockerReply> {
    if(input.path === `/v1.47/containers/${e.request.agentContainer}/json`)return {ok:true,status:200,body:{Id:'a'.repeat(64),Image:actualAgent,
      State:{Status:running?'running':'exited',Running:running,Restarting:false,Dead:false,Pid:running?123:0},
      Config:{Env:[`BEETLE_AGENT_CONFIG_FILE=${installed.paths.agent}`]}}};
    if(input.path.startsWith('/v1.47/containers/json?'))return {ok:true,status:200,body:[]};
    const reply = await provisionDocker.request(input);
    if (input.path.startsWith('/v1.47/images/') && reply.ok) {
      return {...reply, body:{...(reply.body as Record<string,unknown>), Id:input.path.includes('synthetic-export')?exportPin:input.path.includes('agent')?agentPin:enginePin}};
    }
    return reply;
  }};
  const context = () => ({...e.context, docker, backendWorkerUrl:worker, deadline:performance.now()+30000});
  const input = {request,operationId,memoryBytes:1073741824};
  const settings = () => {const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare("SELECT version,value_json FROM settings WHERE kind='installation'").get();}finally{db.close();}};
  return {...e,request,installed,path,input,context,settings,setRunning(value:boolean){running=value;},
    setImagePins(agent:string,engine:string){agentPin=agent;enginePin=engine;},setActualAgent(image:string){actualAgent=image;}};
}
it('changes one existing installation to1GiB, keeps baseline and history, and replays the committed operation', async () => {
  const e = await setup(); const baseline=await readFile(e.installed.paths.receipt);const config=await readFile(e.installed.paths.agent);
  expect(await changeInstalledMemory(e.input,e.context())).toMatchObject({status:'changed',installationId:e.installed.installationId});
  const row=e.settings()!;expect(row.version).toBe(2);
  expect(JSON.parse(String(row.value_json)).perRunCeilings.memoryBytes).toBe(1073741824);
  const loaded=await loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE:e.installed.paths.agent},f.worker());
  try{expect(loaded.runtime.configuration.perRun.memoryBytes).toBe(1073741824);}finally{await loaded.close();}
  expect(await changeInstalledMemory(e.input,e.context())).toMatchObject({status:'unchanged'});
  expect(e.settings()).toEqual(row);
  expect(await readFile(e.installed.paths.receipt)).toEqual(baseline);expect(await readFile(e.installed.paths.agent)).toEqual(config);
  expect(await readFile(join(e.installed.paths.backendData,'history-canary'),'utf8')).toBe('keep');
});
it('refuses a running agent without changing the selector or persisted settings', async () => {
  const e=await setup();const before=await readFile(configurationStatePath(e.root));const settings=e.settings();e.setRunning(true);
  await expect(changeInstalledMemory(e.input,e.context())).rejects.toThrow();
  expect(await readFile(configurationStatePath(e.root))).toEqual(before);expect(e.settings()).toEqual(settings);
});
it('resumes after settings commit but before publication, while serving remains fenced', async () => {
  const e=await setup();const rename=native.rename;
  const failure=vi.spyOn(native,'rename').mockImplementation(async(from,to)=>{
    if(String(from).includes(`${operationId}-commit`))throw new Error('synthetic final publication failure');
    return rename(from,to);
  });
  await expect(changeInstalledMemory(e.input,e.context())).rejects.toThrow('synthetic');failure.mockRestore();
  expect(e.settings()!.version).toBe(2);
  expect(JSON.parse(await readFile(configurationStatePath(e.root),'utf8')).phase).toBe('reconfiguring');
  await expect(loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE:e.installed.paths.agent},f.worker())).rejects.toThrow();
  await expect(changeInstalledMemory({...e.input,operationId:'00000000-0000-4000-8000-000000000098'},e.context())).rejects.toThrow();
  expect(await changeInstalledMemory(e.input,e.context())).toMatchObject({status:'changed'});
  expect(e.settings()!.version).toBe(2);
  expect(JSON.parse(await readFile(configurationStatePath(e.root),'utf8')).phase).toBe('ready');
});

it.each(['before-open','after-open'] as const)('refuses metadata replacement %s before performing settings writes', async phase => {
  const e=await setup();const original=nativeDatabase.open;const prior=e.settings();
  const replacement=vi.spyOn(nativeDatabase,'open').mockImplementationOnce(destination=>{
    const opened=phase==='after-open'?original(destination):undefined;
    renameSync(destination.path,destination.path+'.original');copyFileSync(destination.path+'.original',destination.path);
    return opened??original(destination);
  });
  try {
    await expect(changeInstalledMemory(e.input,e.context())).rejects.toThrow();
    expect(e.settings()).toEqual(prior);
  }finally{
    replacement.mockRestore();unlinkSync(e.path);renameSync(e.path+'.original',e.path);
  }
});
it('retains both startup leases on a nested publication close failure and resumes after process exit', async () => {
  const e=await setup();const file=join(e.root,'fault-request.json');
  await writeFile(file,JSON.stringify({input:e.input,agentWorker:e.context().agentWorkerUrl.href,backendWorker:worker.href}),{mode:0o600});
  const result=await promisify(execFile)(process.execPath,['--import','tsx','tools/install/test/capacity-close.child.ts',file],
    {cwd:process.cwd(),timeout:30000,maxBuffer:8192});
  expect(JSON.parse(result.stdout)).toEqual({code:'cleanup',backendOwned:true,agentOwned:true,repeatRefused:true,phase:'reconfiguring'});
  expect(e.settings()!.version).toBe(1);
  expect(await changeInstalledMemory(e.input,e.context())).toMatchObject({status:'changed'});
  expect(e.settings()!.version).toBe(2);
});

it('preserves immutable baseline pins while replay and a later increase use committed rebuilt images', async () => {
  const e=await setup();const baseline=await readFile(e.installed.paths.receipt);
  const nextAgent='sha256:'+'d'.repeat(64);const nextEngine='sha256:'+'e'.repeat(64);
  e.setImagePins(nextAgent,nextEngine);
  expect(await changeInstalledMemory(e.input,e.context())).toMatchObject({status:'changed'});
  expect((await provisionFreshInstallation(e.request,e.context())).status).toBe('unchanged');
  const loaded=await loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE:e.installed.paths.agent},f.worker());
  try{expect(loaded.runtime.installation.agentImageId).toBe(nextAgent);
    expect(loaded.runtime.catalog.engines[0]!.profile.imageDigest).toBe(nextEngine);
  }finally{await loaded.close();}
  e.setActualAgent(nextAgent);
  expect(await changeInstalledMemory({...e.input,memoryBytes:2147483648,
    operationId:'00000000-0000-4000-8000-000000000097'},e.context())).toMatchObject({status:'changed'});
  expect(e.settings()!.version).toBe(3);
  expect(JSON.parse(String(e.settings()!.value_json)).perRunCeilings.memoryBytes).toBe(2147483648);
  expect(await readFile(e.installed.paths.receipt)).toEqual(baseline);
});

it('updates and replays both normal and offline-export catalogue profiles together', async () => {
  const e=await setup(true);
  expect(await changeInstalledMemory(e.input,e.context())).toMatchObject({status:'changed'});
  const loaded=await loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE:e.installed.paths.agent},f.worker());
  try {
    expect(loaded.runtime.catalog.engines).toHaveLength(2);
    expect(loaded.runtime.catalog.engines.every(engine=>engine.profile.maximumBudget.memoryBytes===1073741824)).toBe(true);
    expect(loaded.runtime.catalog.engines[1]!.profile.network).toEqual({profile:'none',name:'none'});
  }finally{await loaded.close();}
  expect((await provisionFreshInstallation(e.request,e.context())).status).toBe('unchanged');
});

const outputOperationId='00000000-0000-4000-8000-000000000096';
function outputInput(e:Awaited<ReturnType<typeof setup>>) {
 return {request:e.request,operationId:outputOperationId,increase:{resource:'outputPool' as const,bytes:2147483648}};
}
it('grows aggregate output after1GiB memory and preserves history, baseline and per-run budgets',async()=>{
 const e=await setup(true);await changeInstalledMemory(e.input,e.context());
 const baseline=await readFile(e.installed.paths.receipt);const before=JSON.parse(String(e.settings()!.value_json));
 const journalBefore=await readFile(join(e.installed.paths.agentJournal,'journal.sqlite'));
 const input=outputInput(e);expect(await changeInstalledCapacity(input,e.context())).toMatchObject({status:'changed'});
 const row=e.settings()!;expect(row.version).toBe(3);
 expect(JSON.parse(String(row.value_json))).toEqual({...before,pool:{...before.pool,outputBytes:2147483648}});
 const loaded=await loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE:e.installed.paths.agent},f.worker());
 try{
  expect(loaded.runtime.configuration.pool.outputBytes).toBe(2147483648);
  expect(loaded.runtime.configuration.perRun.memoryBytes).toBe(1073741824);
  expect(loaded.runtime.configuration.perRun.outputBytes).toBe(e.request.agentPolicy.perRun.outputBytes);
  expect(loaded.runtime.catalog.engines.every(engine=>engine.profile.maximumBudget.memoryBytes===1073741824)).toBe(true);
 }finally{await loaded.close();}
 expect(await changeInstalledCapacity(input,e.context())).toMatchObject({status:'unchanged'});
 await expect(changeInstalledCapacity({...input,increase:{resource:'memory',bytes:2147483648}},e.context())).rejects.toThrow();
 await expect(changeInstalledCapacity({...input,increase:{resource:'outputPool',bytes:2147483649}},e.context())).rejects.toThrow();
 expect(e.settings()).toEqual(row);expect(await readFile(e.installed.paths.receipt)).toEqual(baseline);
 expect(await readFile(join(e.installed.paths.agentJournal,'journal.sqlite'))).toEqual(journalBefore);
 expect(await readFile(join(e.installed.paths.backendData,'history-canary'),'utf8')).toBe('keep');
 expect((await provisionFreshInstallation(e.request,e.context())).status).toBe('unchanged');
});
it('resumes an output settings commit after interrupted publication and refuses changed kind/amount',async()=>{
 const e=await setup();await changeInstalledMemory(e.input,e.context());const input=outputInput(e);const rename=native.rename;
 const failure=vi.spyOn(native,'rename').mockImplementation(async(from,to)=>{
  if(String(from).includes(`${outputOperationId}-commit`))throw new Error('synthetic output publication failure');
  return rename(from,to);
 });
 await expect(changeInstalledCapacity(input,e.context())).rejects.toThrow('synthetic');failure.mockRestore();
 expect(e.settings()!.version).toBe(3);
 await expect(loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE:e.installed.paths.agent},f.worker())).rejects.toThrow();
 await expect(changeInstalledCapacity({...input,increase:{resource:'memory',bytes:2147483648}},e.context())).rejects.toThrow();
 await expect(changeInstalledCapacity({...input,increase:{resource:'outputPool',bytes:2147483649}},e.context())).rejects.toThrow();
 expect(await changeInstalledCapacity(input,e.context())).toMatchObject({status:'changed'});
 expect(e.settings()!.version).toBe(3);expect(await changeInstalledCapacity(input,e.context())).toMatchObject({status:'unchanged'});
});
it('resumes the earlier memory-only pending format without rewriting its generation or incrementing settings again',async()=>{
 const e=await setup();const rename=native.rename;
 const failure=vi.spyOn(native,'rename').mockImplementation(async(from,to)=>{
  if(String(from).includes(`${operationId}-commit`))throw new Error('synthetic legacy interruption');
  return rename(from,to);
 });
 await expect(changeInstalledMemory(e.input,e.context())).rejects.toThrow('synthetic');failure.mockRestore();
 const path=configurationStatePath(e.root);const state=JSON.parse(await readFile(path,'utf8'));
 const {increase:_increase,digest:_digest,...intent}=state.pending.generation;void _increase;void _digest;
 const generation={...intent,digest:generationDigest(intent,digest)};
 state.pending={operationId,memoryBytes:e.input.memoryBytes,expectedSettings:state.pending.expectedSettings,generation};
 await writeFile(path,JSON.stringify(state),{mode:0o600});
 // Model the old crash before its final publication temporary was written.
 await rm(join(e.root,'config',`.installation-${operationId}-commit`),{force:true});
 expect(await changeInstalledMemory(e.input,e.context())).toMatchObject({status:'changed'});
 expect(e.settings()!.version).toBe(2);
 expect(JSON.parse(await readFile(path,'utf8')).generation).toEqual(generation);
 expect(await changeInstalledMemory(e.input,e.context())).toMatchObject({status:'unchanged'});
});
