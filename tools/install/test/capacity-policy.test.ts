import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createStarterRequest } from '../starter.js';
import { planMemoryChange, planOutputPoolChange } from '../capacity/policy.js';
import type { ProvisionContext } from '../types.js';
import type { InstallationRecord } from '../../../app/src/domain/settings/index.js';
const MiB = 1048576;
function fixture() {
  const request = createStarterRequest({ root: '/synthetic/capacity', uid: process.getuid!(), gid: process.getgid!(),
    externalOrigin: 'https://synthetic.invalid', agentOrigin: 'http://agent:4312', dockerSocket: '/run/docker.sock',
    agentContainer: 'synthetic-agent', agentImage: 'synthetic-agent:v1', engineImage: 'synthetic-engine:v1',
    exportEngineImage: 'synthetic-export:v1', targetNetwork: 'synthetic-target' });
  const settings: InstallationRecord = { id: '00000000-0000-4000-8000-000000000001', version: 4,
    schemaVersion: 2, scope: { kind: 'installation' }, values: structuredClone(request.installationValues) };
  const context: ProvisionContext = { agentWorkerUrl: new URL(import.meta.url), backendWorkerUrl: new URL(import.meta.url),
    signal: new AbortController().signal, deadline: performance.now() + 30000,
    docker: { request: async () => { throw new Error('Pure plan must not call Docker'); } } };
  return { request, settings, context };
}
it('raises per-run/default memory while preserving user settings and all other installed policy', () => {
  const { request, settings, context } = fixture();
  settings.values.retention = { mode: 'enabled', completedRunCount: 7 };
  const before = structuredClone({ request, settings });
  const plan = planMemoryChange(request, settings, 1024 * MiB, context);
  expect(plan.request.installationValues.perRunCeilings.memoryBytes).toBe(1024 * MiB);
  expect(plan.request.installationValues.runDefaults.budget.memoryBytes).toBe(1024 * MiB);
  expect(plan.request.installationValues.retention).toEqual(settings.values.retention);
  expect(plan.request.agentPolicy).toEqual({ ...request.agentPolicy,
    perRun: { ...request.agentPolicy.perRun, memoryBytes: 1024 * MiB } });
  expect(plan.request.engine).toEqual({ ...request.engine, catalogVersion: request.engine.catalogVersion + 1 });
  expect(plan.request.exportEngine).toEqual({ ...request.exportEngine, catalogVersion: request.exportEngine!.catalogVersion + 1 });
  expect(plan.previousSettings).toEqual(settings);
  expect({ request, settings }).toEqual(before);
});
it.each([0, -1, 512 * MiB, 256 * MiB, 1025 * MiB, 1.5, NaN, Infinity])('refuses invalid or unsupported memory %s', memory => {
  const f = fixture();
  expect(() => planMemoryChange(f.request, f.settings, memory, f.context)).toThrow();
});
it('refuses a ceiling above the current persisted pool rather than silently enlarging it', () => {
  const f = fixture(); f.settings.values.pool.memoryBytes = 768 * MiB;
  expect(() => planMemoryChange(f.request, f.settings, 1024 * MiB, f.context)).toThrow();
});
it('refuses exhausted catalogue versions', () => {
  const f = fixture(); const request = { ...f.request, engine: { ...f.request.engine, catalogVersion: Number.MAX_SAFE_INTEGER } };
  expect(() => planMemoryChange(request, f.settings, 1024 * MiB, f.context)).toThrow();
});

it('grows aggregate output within the existing storage allocation and preserves a previously raised memory limit',()=>{
 const f=fixture();const memory=planMemoryChange(f.request,f.settings,1024*MiB,f.context);
 const settings={...f.settings,version:f.settings.version+1,values:structuredClone(memory.request.installationValues)};
 settings.values.retention={mode:'enabled',completedRunCount:7};
 const before=structuredClone({request:memory.request,settings});
 const plan=planOutputPoolChange(memory.request,settings,512*MiB,f.context);
 expect(plan.request.installationValues).toEqual({...settings.values,pool:{...settings.values.pool,outputBytes:512*MiB}});
 expect(plan.request.agentPolicy).toEqual({...memory.request.agentPolicy,pool:{...memory.request.agentPolicy.pool,outputBytes:512*MiB}});
 expect(plan.request.installationValues.perRunCeilings.memoryBytes).toBe(1024*MiB);
 expect(plan.request.agentPolicy.perRun.memoryBytes).toBe(1024*MiB);
 expect(plan.request.engine.catalogVersion).toBe(memory.request.engine.catalogVersion+1);
 expect(plan.request.exportEngine?.catalogVersion).toBe(memory.request.exportEngine!.catalogVersion+1);
 expect(plan.previousSettings).toEqual(settings);expect({request:memory.request,settings}).toEqual(before);
});
it.each([0,-1,64*MiB,128*MiB,2048*MiB,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])(
 'refuses invalid/non-increasing output or output exceeding the existing storage allocation: %s',bytes=>{
  const f=fixture();expect(()=>planOutputPoolChange(f.request,f.settings,bytes,f.context)).toThrow();
 });
it('refuses output increases that would consume the existing free-space reserve',()=>{
 const f=fixture();f.settings.values.pool.storageBytes=700*MiB;
 expect(()=>planOutputPoolChange(f.request,f.settings,512*MiB,f.context)).toThrow();
});
