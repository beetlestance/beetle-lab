import {expect,it} from 'vitest';
import {provisionFreshInstallation,inspectReadyConfiguration} from '../index.js';
import {starterExport} from '../starter/export.js';
import {loadAgentConfiguration} from '../../../agent/src/bootstrap/index.js';
import {openJournal} from '../../../agent/src/journal/index.js';
import {openServingState} from '../../../agent/src/installation-state/index.js';
import {installationStatePath} from '../../../agent/src/bootstrap/index.js';
import {loadBackendConfiguration} from '../../../app/src/bootstrap/configuration.js';
import {fixture} from './fixtures.js';
const f=fixture();
it('installs the exact offline catalogue/profile mapping and checks ready configuration while serving owns the Journal',async()=>{
 const e=await f.setup();const image='sha256:'+'d'.repeat(64);const request={...e.request,agentIdentity:'socket-group-drop-v1' as const,exportEngine:starterExport(e.request.engine,'synthetic-export:v1')};
 const transport=e.context.docker;const docker:typeof transport={async request(input){const reply=await transport.request(input);
  return input.path.includes('synthetic-export')&&reply.ok?{...reply,body:{...reply.body as object,Id:image,Config:{Env:['PATH=/usr/bin']}}}:reply;
 }};
 const result=await provisionFreshInstallation(request,{...e.context,docker});const loaded=await loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE:result.paths.agent},f.worker());
 const gate=openServingState(installationStatePath(loaded.runtime.journal.path));const journal=await openJournal(loaded.runtime.journal);
 try{
  expect(loaded.runtime.installation.agentIdentity).toBe('socket-group-drop-v1');
  const engines=loaded.runtime.catalog.engines;expect(engines).toHaveLength(2);expect(engines[1]!.manifest.imageDigest).toBe(image);
  expect(engines[1]!.profile.network).toEqual({profile:'none',name:'none'});expect(engines[1]!.profile.liveMetricMailbox).toBeUndefined();
  const backend=await loadBackendConfiguration({BEETLE_CONFIG_FILE:result.paths.installation,BEETLE_AGENT_CONFIG_FILE:result.paths.backendAgent,
   BEETLE_DATA_DIR:result.paths.backendData,BEETLE_EXTERNAL_ORIGIN:request.externalOrigin},f.worker());
  expect(backend.application.agent?.connection.configuration.exportProfiles).toEqual([{sourceProfileId:request.engine.profileId,profile:{
   engine:{id:'k6',imageDigest:image,configVersion:1,profileId:'k6-export-local'},installedIdentity:engines[1]!.installedIdentity,requiredCapabilities:['standalone-export-v1']}}]);
  const authority=await journal.journalAuthority();gate.assertJournalAuthority(authority);
  expect(await inspectReadyConfiguration(request,{...e.context,docker})).toMatchObject({readiness:'configuration_only',installationId:result.installationId});
  expect(await journal.journalAuthority()).toBe(authority);expect(e.calls.every(call=>call.method==='GET')).toBe(true);
 }finally{await loaded.close();await journal.close();gate.close();}
});
