import {K6_LIVE_METRIC_IMAGE_ENV} from '@beetle/contracts/k6-live';
import {createK6ConfigSchema} from '@beetle/contracts/engine-config/k6';
import {createEngineCatalog} from '../../../agent/src/catalog/index.js';
import type {EngineRegistration} from '../../../agent/src/catalog/index.js';
import type {Captured} from './capture.js';
import {digest,requireInput} from './capture.js';
import type {Facts} from './inspection.js';
import type {ProvisionEngine} from '../types.js';
/** Shared catalogue derives all installed identities; this owner supplies only inspected facts. */
export function configuredEngines(c:Captured,installationId:string,facts:Facts){
 const normal=registration({c,installationId,facts,template:c.request.engine,image:{id:facts.engineId,environment:facts.environment},offline:false});
 const registrations=[normal];
 if(c.request.exportEngine){
  requireInput(facts.export!==undefined);
  registrations.push(registration({c,installationId,facts,template:c.request.exportEngine,image:facts.export,offline:true}));
 }
 return {registrations,catalog:createEngineCatalog(registrations)};
}
function registration(input:{c:Captured;installationId:string;facts:Facts;template:ProvisionEngine;image:{id:string;environment:string[]};offline:boolean}):EngineRegistration{
 const {c,installationId,facts,template,image,offline}=input;const r=c.request;const schema=createK6ConfigSchema(digest);
 requireInput(template.manifest.schemas.config===schema.schemaId);
 const manifest={...template.manifest,imageDigest:image.id};
 const profile={installationId,imageDigest:image.id,entrypoint:manifest.entrypoint,
  effectiveImage:{imageDigest:image.id,environment:image.environment,defaultRuntime:facts.defaultRuntime},
  user:`${r.uid}:${r.gid}`,stagingRoot:r.root+'/agent/staging',
  ...(!offline&&image.environment.includes(`${K6_LIVE_METRIC_IMAGE_ENV}=1`)?{liveMetricMailbox:true}:{}),
  network:offline?{profile:'none' as const,name:'none'}:{profile:'target-egress' as const,name:r.targetNetwork},
  tmpfsBytes:template.tmpfsBytes,maximumBudget:r.installationValues.perRunCeilings};
 const {manifestId,profileId,catalogVersion,configVersion}=template;
 return {manifest,profile,configVersion,configSchema:schema,validation:{manifestId,profileId,catalogVersion,schemaDigest:schema.schemaDigest}};
}
export function engineConfiguration(registration:EngineRegistration){
 const {manifest,profile,configVersion,validation:{manifestId,profileId,catalogVersion}}=registration;
 return {manifest,profile,configVersion,manifestId,profileId,catalogVersion};
}
