import { createHash } from 'node:crypto';
import { rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { createStandaloneExportAssignment } from '@beetle/contracts';
import type { SuiteConfig } from '../../../../engines/k6/compiler/suite/index.js';
import { fixture,syntheticInstalledIdentity,uuid } from '../../../../engines/k6/test/staged-input/fixtures.js';
import type { Fixture } from '../../../../engines/k6/test/staged-input/fixtures.js';
export function exportFixture(){
  const owned:Fixture[]=[];afterEach(async()=>{for(const f of owned.splice(0)){f.controller.abort();await f.cleanup();}});
  return async()=>{
    const f=await fixture();owned.push(f);const config=f.offer.config as unknown as SuiteConfig;
    config.secrets=[];config.requests[0]!.headers={};f.offer.secretReferences=[];f.staging.secretNames=[];
    await rm(join(f.options.secretRoot,'_TOKEN'));f.staging.generation=1;
    f.manifest.schemas.result='https://beetle-lab.dev/contracts/runner/v1/export-result';
    f.manifest.capabilities=['standalone-export-v1'];f.offer.requiredCapabilities=['standalone-export-v1'];
    f.manifest.network={required:false,profile:'none'};f.manifest.entrypoint={executable:'node',arguments:['/beetle/bootstrap/export-main.js']};
    for(const phase of f.manifest.phases){phase.timeoutMs=20000;phase.outputBytes=900000;}
    f.offer.installedIdentity=syntheticInstalledIdentity(f.manifest);
    const assignment=createStandaloneExportAssignment({version:1,purpose:'standalone_export',exportId:uuid(20),requestId:uuid(21),
      source:{revisionId:uuid(22),revisionDigest:'c'.repeat(64)},offer:f.offer,options:{scriptTimeoutMs:180000,maximumBuildBytes:900000}},
      text=>createHash('sha256').update(text).digest('hex'));
    const exportAssignment={purpose:'standalone_export' as const,assignmentDigest:assignment.assignmentDigest};
    f.staging.assignment={...exportAssignment,fileName:'assignment.json'};
    f.options={...f.options,exportAssignment,installed:{...f.options.installed,resultSchema:f.manifest.schemas.result}};
    await f.save();await writeFile(join(f.options.inputRoot,'assignment.json'),JSON.stringify(assignment),{mode:0o600});
    return {...f,assignment,options:{...f.options,outputRoot:f.root}};
  };
}
