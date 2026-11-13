import type {DatabaseSync} from 'node:sqlite';
import {transaction} from '../transaction.js';
import type {ExportReads} from './reads.js';
import {ExportSources} from './source.js';
import {adoptExportSource} from './custody.js';
import {advanceExportArtifact} from './artifacts.js';
import {finalizeExport} from './finalization.js';
import {settleExportAbsence} from './absence.js';
import type {ExportKey} from '../../../../ports/exports.js';
import type {ExportExecutionStore} from '../../../../ports/exports.js';
import type {ExportOutputCommand,ExportOutputValue} from './output-protocol.js';
import type {ExportJob} from '@beetle/contracts/api';
import {control} from './originals.js';
import {StorageError} from '../protocol.js';
export class ExportOutputs {
 private readonly sources:ExportSources;
 constructor(private readonly db:DatabaseSync,private readonly reads:ExportReads){this.sources=new ExportSources(db,reads);}
 execute(command:ExportOutputCommand):ExportOutputValue {
  return transaction(this.db,()=>{
   switch(command.method){
    case 'load':return this.sources.load(command.binding);
    case 'source':return this.sources.read(command.binding);
    case 'adopt':return adoptExportSource(this.db,this.sources,command.request);
    case 'artifact':return advanceExportArtifact(this.db,this.sources,command.operation);
    case 'absence':return settleExportAbsence(this.db,this.sources,this.reads,command.request);
    case 'published':return this.published(command.key);
   }
  });
 }
 private published(key:ExportKey){
     const job=this.reads.get(key);if(job.state!=='ready')throw new StorageError('conflict');
     const binding=control(this.db,this.reads,key).binding;if(!binding)throw new StorageError('unavailable');
     const source=this.sources.read(binding);const artifact=this.sources.artifact(binding);
     if(!source||!artifact||artifact.phase!=='published'||artifact.offset!==artifact.bytes||artifact.writer!==null||artifact.identity===null)throw new StorageError('unavailable');
     return {binding,artifact};
 }
 finalize(request:Parameters<ExportExecutionStore['finalize']>[0]):ExportJob{return transaction(this.db,()=>finalizeExport(this.db,this.sources,this.reads,request));}
}
