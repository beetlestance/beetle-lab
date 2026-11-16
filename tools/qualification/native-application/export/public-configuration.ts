import {deriveInstalledIdentity} from '@beetle/contracts';
import type {EngineManifest} from '@beetle/contracts';
import {readFile,writeFile} from 'node:fs/promises';
import type {Fixture} from '../../../../agent/test/container/fixture.js';
import type {Image} from '../../../../agent/test/container/docker.js';
import {digest} from '../../../../agent/test/container/fixture.js';
import {backendConfiguration} from '../configuration.js';
/** The ordinary profile and the fixed offline profile share one installed agent. */
export function offlineProfile(f:Fixture,image:Image){
 const manifest:EngineManifest={...structuredClone(f.manifest),imageDigest:image.Id,schemas:{...f.manifest.schemas,
  result:'https://beetle-lab.dev/contracts/runner/v1/export-result'},capabilities:['standalone-export-v1'],
  network:{required:false,profile:'none'},entrypoint:{executable:'node',arguments:['/beetle/bootstrap/export-main.js']}};
 for(const phase of manifest.phases)phase.timeoutMs=phase.phase==='prepare'?20000:5000;
 const {liveMetricMailbox:unused,...ordinary}=f.profile;void unused;
 const profile={...ordinary,imageDigest:image.Id,entrypoint:manifest.entrypoint,network:{profile:'none' as const,name:'none'},
  effectiveImage:{...ordinary.effectiveImage,imageDigest:image.Id,environment:image.Config.Env}};
 const identity={manifestId:'k6-export-native',profileId:'native-export',catalogVersion:1,schemaDigest:f.offer.installedIdentity.schemaDigest};
 const installedIdentity=deriveInstalledIdentity({manifest,profile,identity},digest);
 const pin={engine:{id:'k6' as const,imageDigest:image.Id,configVersion:1 as const,profileId:'native-export'},installedIdentity,requiredCapabilities:['standalone-export-v1']};
 return {manifest,profile,identity,installedIdentity,pin};
}
export async function addOfflineEngine(path:string,offline:ReturnType<typeof offlineProfile>):Promise<void>{
 const config=JSON.parse(await readFile(path,'utf8')) as {engines:unknown[]};
 const {manifestId,profileId,catalogVersion}=offline.identity;
 config.engines.push({manifest:offline.manifest,profile:offline.profile,configVersion:1,manifestId,profileId,catalogVersion});
 await writeFile(path,JSON.stringify(config),{mode:0o600});
}
export async function exportBackendConfiguration(f:Fixture,agent:string,origin:string,pin:ReturnType<typeof offlineProfile>['pin']){
 const config=await backendConfiguration(f,agent,origin);const application=config.application;const runtime=application.agent;
 if(!runtime)throw new Error('Missing qualification agent');
 return {...config,application:{...application,agent:{...runtime,connection:{...runtime.connection,
  configuration:{...runtime.connection.configuration,exportProfiles:[{sourceProfileId:'native-k6',profile:pin}]}}}}};
}
