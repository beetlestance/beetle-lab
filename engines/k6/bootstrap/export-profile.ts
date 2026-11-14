import type { StagedExportOptions } from '../wrapper/export/index.js';
/** Purpose/digest originate in the exact trusted runtime specification. */
export function exportImageOptions(signal:AbortSignal):StagedExportOptions {
  const digest=process.env.BEETLE_ASSIGNMENT_DIGEST;
  if (process.env.BEETLE_JOB_PURPOSE !== 'standalone_export' || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('export_profile');
  return Object.freeze({inputRoot:'/beetle/input',secretRoot:'/beetle/secrets',outputRoot:'/beetle/output',uid:process.getuid!(),
    headerTimeoutMs:5000,signal,exportAssignment:Object.freeze({purpose:'standalone_export',assignmentDigest:digest}),
    installed:Object.freeze({id:'k6',version:'2.4.0',configVersion:1,configSchema:'https://beetle.test/contracts/engines/k6/v1/suite',
      resultSchema:'https://beetle-lab.dev/contracts/runner/v1/export-result'})});
}
