import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {readDeliveryJson} from '../../../delivery/files.js';
import {record} from '../../resources/values.js';
import {publicSnapshot} from './snapshot.js';
const [root,revision,destination,extra]=process.argv.slice(2);assert(root&&revision&&destination&&isAbsolute(root)&&isAbsolute(destination)&&!extra);
assert(/^[a-f0-9]{40}$/.test(revision));let facts:ReturnType<typeof publicSnapshot>|null=null;
const architecture=process.arch==='x64'?'amd64':process.arch;assert(['amd64','arm64'].includes(architecture));
try{
 const owner=record(await readDeliveryJson(join(root,'installation-owner.json')));assert(typeof owner.installationId==='string');
 const raw=await readDeliveryJson(join(root,'outcome-private.json'));assert.equal(record(raw).harnessNode,process.version);
 facts=publicSnapshot(raw,await readDeliveryJson(join(root,'component-private.json')),{revision,architecture,installationId:owner.installationId});
}catch{ /* Missing, malformed or failed execution never becomes accepted evidence. */ }
const git=(args:string[])=>execFileSync('git',args,{timeout:10000,maxBuffer:65536,encoding:'utf8'}).trim();
const harnessRevision=git(['rev-parse','HEAD']);assert.equal(harnessRevision,process.env.GITHUB_SHA);
const harnessDirty=git(['status','--porcelain','--untracked-files=all']).length>0;
const executionSucceeded=process.env.BEETLE_TELEMETRY_EXECUTION==='success';const independentCleanupVerified=process.env.BEETLE_TELEMETRY_CLEANUP==='success';
const status=facts?.measurementStatus==='passed'&&!harnessDirty&&executionSucceeded&&independentCleanupVerified?'passed':'failed';
await writeFile(destination,JSON.stringify({format:'beetle-telemetry-comparison',version:1,status,sourceRevision:revision,architecture,harnessRevision,harnessDirty,
 executionSucceeded,independentCleanupVerified,evidenceAvailable:facts!==null,facts},null,2),{flag:'wx',mode:0o600});
if(status!=='passed')process.exitCode=1;
