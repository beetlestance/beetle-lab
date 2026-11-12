import {prepareK6SecretReferences} from '@beetle/contracts/engine-config/k6';
import {createStandaloneExportAssignment,encodeCanonicalJson,validate} from '@beetle/contracts';
import type {StandaloneExportAssignment,Offer} from '@beetle/contracts';
import type {ExportJob,SuiteRevision} from '@beetle/contracts/api';
import type {CreateExportCommand,ExportProfilePin} from '../../../../ports/exports.js';
import {requireRule} from '../../../../domain/namespaces/index.js';
import {k6ConfigSchema} from '../../execution-profiles/index.js';
import {sha256} from '../input-values.js';

export function makeExportAssignment(job:ExportJob,revision:SuiteRevision,pin:ExportProfilePin,command:CreateExportCommand):StandaloneExportAssignment {
 requireRule(k6ConfigSchema.validate(revision.config));
 const secrets=prepareK6SecretReferences(revision.config.secrets);requireRule(secrets.ok&&secrets.value.length===0);
 const body={protocolVersion:'1.0' as const,organizationId:job.scope.organizationId,workspaceId:job.scope.workspaceId,
  attemptId:job.activeAttemptId,engine:{id:pin.profile.engine.id,imageDigest:pin.profile.engine.imageDigest,configVersion:pin.profile.engine.configVersion},
  installedIdentity:pin.profile.installedIdentity,inputs:revision.inputManifest,budget:job.budget,executionPolicy:job.executionPolicy,
  requiredCapabilities:[...pin.profile.requiredCapabilities],secretReferences:[],config:revision.config};
 const original={purpose:'standalone_export',exportId:job.id,source:{revisionId:revision.id,revisionDigest:revision.digest},body,options:job.options};
 const intentDigest=sha256('beetle-lab.export-offer.v1\n'+encodeCanonicalJson(original,2105344));
 const offer:Offer={...body,intentDigest};requireRule(validate('Offer',offer).ok);
 return createStandaloneExportAssignment({version:1,purpose:'standalone_export',exportId:job.id,requestId:command.request.requestId,
  source:original.source,offer,options:job.options},sha256);
}
