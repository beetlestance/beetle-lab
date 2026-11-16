import { AttemptError } from '../wrapper/failure/index.js';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { captureStandaloneExportAssignment, encodeCanonicalJson, RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { StandaloneExportAssignment } from '@beetle/contracts';
import type { StagedInput } from '../wrapper/input/index.js';
import type { AttemptFence } from '../wrapper/lifecycle/index.js';
import { sealExportScript } from '../wrapper/artifact-custody/index.js';
import type { ExportScriptJob } from '../wrapper/artifact-custody/index.js';
import { startStandaloneBuild } from './lifetime.js';
export class ExportOperationError extends Error {
  constructor(readonly code: 'binding' | 'cancelled' | 'closed' | 'deadline' | 'clock_fenced' | 'generation_failed' | 'cleanup') {super('Standalone export operation rejected');}
}
export interface ExportOperationInput {
  readonly assignment: unknown;
  /** Ownership of compile/close transfers on successful factory return. */
  readonly staged: StagedInput;
  readonly fence: AttemptFence;
  readonly outputRoot: string;
  readonly uid: number;
  /** Trusted phase-writer callback; its owner retains native close work. */
  readonly onCollect?: (usage: Readonly<{bytes:number;peakBytes:number}>) => Promise<void>;
}
export interface ExportOperationOutput {
  readonly artifact: Awaited<ExportScriptJob['result']>;
  readonly buildUsage: Readonly<{bytes:number; peakBytes:number}>;
}
export interface ExportOperation {
  readonly result: Promise<ExportOperationOutput>;
  /** Original composition including staged close; not physical container absence. */
  readonly settled: Promise<void>;
  close(): Promise<void>;
}
function requireProfile(input: ExportOperationInput): void {
    if (typeof input.outputRoot !== 'string' || !isAbsolute(input.outputRoot) || resolve(input.outputRoot) !== input.outputRoot
      || input.outputRoot.includes('\0') || Buffer.byteLength(input.outputRoot)>4000 || !Number.isSafeInteger(input.uid) || input.uid !== process.getuid?.()) throw new Error();
}
function capture(input: ExportOperationInput): StandaloneExportAssignment {
  try {
    requireProfile(input);
    if (input.onCollect !== undefined && typeof input.onCollect !== 'function') throw new Error();
    const assignment=captureStandaloneExportAssignment(input.assignment,value=>createHash('sha256').update(value).digest('hex'));
    if (input.staged.assignment?.assignmentDigest !== assignment.assignmentDigest
      || input.staged.staging.assignment?.assignmentDigest !== assignment.assignmentDigest || input.staged.staging.generation !== 1 || encodeCanonicalJson(assignment.offer,RUNNER_MAXIMUM_OFFER_BYTES)
      !== encodeCanonicalJson(input.staged.offer,RUNNER_MAXIMUM_OFFER_BYTES)) throw new Error();
    return assignment;
  } catch {throw new ExportOperationError('binding');}
}
async function generate(input: ExportOperationInput, assignment: StandaloneExportAssignment): Promise<ExportOperationOutput> {
  input.fence.narrow(input.staged);
  const compile=input.staged.compile();
  const compiled=await compile.result.finally(()=>compile.quiesced);
  if (!compiled.ok) throw new ExportOperationError('generation_failed');
  input.fence.check();
  const built=startStandaloneBuild({suite:compiled.value.suite, outputDirectory:join(input.outputRoot,'standalone'),
    timeoutMs:assignment.options.scriptTimeoutMs,maximumBuildBytes:assignment.options.maximumBuildBytes,
    signal:input.fence.controller.signal,deadline:performance.now()+input.fence.lifetimeRemaining()});
  const output=await built.result.finally(()=>built.settled);
  input.fence.check();
  await input.onCollect?.(Object.freeze({bytes:output.bytes,peakBytes:output.peakBytes}));input.fence.check();
  const custody=sealExportScript({outputRoot:input.outputRoot,uid:input.uid,built:output,
    maximumBuildBytes:assignment.options.maximumBuildBytes,fence:input.fence});
  const artifact=await custody.result.finally(()=>custody.settled);
  input.fence.check();
  return Object.freeze({artifact,buildUsage:Object.freeze({bytes:output.bytes,peakBytes:output.peakBytes})});
}
/** Engine composition inside a separately admitted container, never backend-local compilation. */
export function startExportOperation(input: ExportOperationInput): ExportOperation {
  const assignment=capture(input); const owned=Object.freeze({...input});
  let reason: ExportOperationError | undefined; let reject!: (error:ExportOperationError)=>void;
  const stopped=new Promise<never>((_,no)=>{reject=no;});
  const abort=()=>{const cause=owned.fence.reason; reason ??= new ExportOperationError(cause==='deadline'?'deadline':cause==='clock'?'clock_fenced':cause==='cancelled'?'cancelled':'generation_failed'); reject(reason);};
  const original=Promise.resolve().then(()=>generate(owned,assignment)).finally(async()=>{
    try {await owned.staged.close();} catch {throw new ExportOperationError('cleanup');}
  });
  const settled=original.then(()=>undefined,error=>{throw operationFailure(error);});
  const result=Promise.race([original,stopped]).then(value=>{owned.fence.check();return value;})
    .catch(error=>{throw reason ?? (operationFailure(error));})
    .finally(()=>owned.fence.controller.signal.removeEventListener('abort',abort));
  owned.fence.controller.signal.addEventListener('abort',abort,{once:true});
  if (owned.fence.controller.signal.aborted) abort();
  void result.catch(()=>undefined);void settled.catch(()=>undefined);void stopped.catch(()=>undefined);
  return Object.freeze({result,settled,close(){reason ??= new ExportOperationError('closed');reject(reason);owned.fence.stop('cancelled');return settled;}});
}

function operationFailure(error:unknown):ExportOperationError {
  if (error instanceof ExportOperationError) return error;
  return new ExportOperationError(error instanceof AttemptError && error.reason==='cleanup'?'cleanup':'generation_failed');
}
