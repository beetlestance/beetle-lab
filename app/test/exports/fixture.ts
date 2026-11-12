import type {MetadataOptions} from '../../src/adapters/outbound/sqlite/index.js';
import {prepareExportCommand} from '../../src/application/exports/index.js';
import {runOptions,runRequest} from '../storage/runs-fixture.js';
import {settingsFixture,observation,digest,uuid} from '../storage/fixture.js';
export function options(limit=256):Partial<MetadataOptions>{
 const fixture=settingsFixture();const run=runOptions(limit).runs!;const profile=structuredClone(run.profiles[0]!);
 profile.engine={...profile.engine,profileId:'standard-export',imageDigest:'sha256:'+'e'.repeat(64)};
 profile.installedIdentity={...profile.installedIdentity,manifestId:'k6-export',profileId:'docker-export',manifestDigest:'e'.repeat(64),profileDigest:'f'.repeat(64)};
 profile.requiredCapabilities=['standalone-export-v1'];
 const installation=fixture.chain.installation;installation.values.pool.outputBytes=2097152;installation.values.pool.storageBytes=33554432;
 installation.values.perRunCeilings.outputBytes=1048576;installation.values.runDefaults.budget.outputBytes=300000;
 const runtime=fixture.runtime;runtime.pool.outputBytes=4194304;runtime.pool.storageBytes=67108864;runtime.perRun.outputBytes=2097152;
 return {installation,runtime:observation(runtime),runs:run,exports:{pendingLimit:limit,profiles:[{sourceProfileId:'standard',profile}]}};
}
export function createCommand(revisionId:string,id=500,request={...runRequest(revisionId),budget:{...runRequest(revisionId).budget,outputBytes:300000},options:{scriptTimeoutMs:180000,maximumBuildBytes:100000}}){
 return prepareExportCommand({kind:'createExport',id:uuid(id),attemptId:uuid(id+1000),requestedAt:'2026-11-12T00:00:00.000Z',request},digest);
}
