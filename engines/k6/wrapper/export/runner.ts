import { createHash } from 'node:crypto';
import { EXPORT_CONTROL_BYTES, EXPORT_RESULT_BYTES, sealStandaloneExportResult } from '@beetle/contracts';
import type { StandaloneExportResult } from '@beetle/contracts';
import { startExportOperation, ExportOperationError } from '../../export/index.js';
import type { ExportOperation } from '../../export/index.js';
import { openStagedInput } from '../input/index.js';
import type { StagedInput } from '../input/index.js';
import { createControlWriter } from '../control/index.js';
import type { ControlWriter } from '../control/index.js';
import { outputRoot } from '../artifact-custody/index.js';
import { AttemptFence, Phases, Notifications } from '../lifecycle/index.js';
import { publishExportResult } from '../publication/index.js';
import type { ResultPublication } from '../publication/index.js';
import type { StagedExportOptions, ExportReceipt } from './types.js';
/** One container-owned generation; physical containment remains with the agent. */
export class ExportRunner {
  private stage:'input'|'generation'|'publication'='input';
  private readonly fence: AttemptFence;
  private readonly notifications: Notifications;
  private staged: StagedInput | undefined;
  private writer: ControlWriter | undefined;
  private phases: Phases | undefined;
  private generation: ExportOperation | undefined;
  private publication: ResultPublication<StandaloneExportResult> | undefined;
  constructor(private readonly options: StagedExportOptions) {
    this.fence=new AttemptFence({wall:options.wallNow ?? Date.now,monotonic:()=>performance.now()},options.signal,options.headerTimeoutMs);
    this.notifications=new Notifications(options.onEvent,this.fence);
  }
  async run(): Promise<ExportReceipt> {
    let receipt: ExportReceipt;
    try {receipt={ok:true,result:await this.generate()};}
    catch {receipt={ok:false,reason:this.reason()};}
    if (!await this.drain()) receipt={ok:false,reason:'cleanup'};
    try {if (receipt.ok) this.fence.check();} catch {receipt={ok:false,reason:this.reason()};}
    this.fence.dispose();return receipt;
  }
  private async drain():Promise<boolean> {
    const cleanup=await Promise.allSettled([this.phases?.stop(),this.generation?.settled.catch(error=>{if (!(error instanceof ExportOperationError) || error.code!=='generation_failed') throw error;}),this.publication?.quiesced]);
    const closes=await this.close();
    return ![...cleanup,...closes].some(value=>value.status==='rejected');
  }
  private async close():Promise<PromiseSettledResult<void | undefined>[]> {
    return await Promise.allSettled([this.staged?.close(),this.publication?.close(),this.writer?.close(),this.notifications.quiesce()]);
  }
  private reason(): Extract<ExportReceipt,{ok:false}>['reason'] {
    const reason=this.fence.reason;
    return reason==='cancelled'||reason==='deadline' ? reason : reason==='clock' ? 'clock' : this.stage;
  }
  private async generate(): Promise<StandaloneExportResult> {
    const opening=openStagedInput({...this.options,signal:this.fence.controller.signal});
    const opened=await opening.result.finally(()=>opening.quiesced);
    if (!opened.ok) throw new Error('input');this.staged=opened.value;
    const assignment=this.staged.assignment;if (!assignment) throw new Error('profile');
    this.fence.bind(this.staged);
    await outputRoot({directory:this.options.outputRoot,uid:this.options.uid,fence:this.fence,resultFile:'export-result.json'});
    const scope={organizationId:assignment.offer.organizationId,workspaceId:assignment.offer.workspaceId,attemptId:assignment.offer.attemptId,generation:1};
    this.writer=await createControlWriter({directory:this.options.outputRoot,scope,quotaBytes:EXPORT_CONTROL_BYTES},this.fence.budget());
    this.phases=new Phases(this.writer,scope,this.staged.manifest,this.fence,this.notifications);
    await this.phases.start('validate');await this.phases.transition('prepare',1);
    this.stage='generation';
    this.generation=startExportOperation({assignment,staged:this.staged,fence:this.fence,outputRoot:this.options.outputRoot,uid:this.options.uid,
      onCollect:usage=>this.phases!.transition('collect',1,undefined,usage.bytes)});
    const generated=await this.generation.result.finally(()=>this.generation!.settled);
    await this.phases.transition('seal',1);this.fence.check();
    const seal=sealStandaloneExportResult({version:1,purpose:'standalone_export',exportId:assignment.exportId,...scope,
      assignmentDigest:assignment.assignmentDigest,status:'succeeded',reason:null,artifact:generated.artifact,buildUsage:generated.buildUsage},
      this.fence.timestamp(),text=>createHash('sha256').update(text).digest('hex'));
    if (!seal.ok) throw new Error('seal');
    const event=this.phases.resultDraft(seal.value);
    this.stage='publication';
    this.publication=publishExportResult({purpose:'standalone_export',assignment,result:seal.value,expectedScope:scope,directory:this.options.outputRoot,
      uid:this.options.uid,maximumBytes:EXPORT_RESULT_BYTES,deadlineMs:this.staged.attempt.deadlineMs,timeoutMs:Math.max(1,Math.floor(this.fence.remaining())),
      signal:this.fence.controller.signal,wallNow:this.options.wallNow ?? Date.now});
    const published=await this.publication.result.finally(()=>this.publication!.quiesced);
    if (!published.ok) throw new Error('publication');
    await this.phases.result(event);await this.phases.finish(1,published.bytes);this.fence.check();
    return published.value;
  }
}
