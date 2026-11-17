import type { ExportArtifacts, ExportExecutionStore, ExportStore } from '../../../ports/exports.js';
import type { Operation, Value } from './protocol.js';
type Send = (operation: Operation) => Promise<Value>;

export function exportArtifactClient(send: Send): ExportArtifacts {
  return {
    published: (key) =>
      send({ kind: 'exportOutput', operation: { method: 'published', key } }) as ReturnType<
        ExportArtifacts['published']
      >,
    settleAbsence: (request) =>
      send({ kind: 'exportOutput', operation: { method: 'absence', request } }) as ReturnType<
        ExportArtifacts['settleAbsence']
      >,
    load: (binding) =>
      send({ kind: 'exportOutput', operation: { method: 'load', binding } }) as ReturnType<ExportArtifacts['load']>,
    readSource: (binding) =>
      send({ kind: 'exportOutput', operation: { method: 'source', binding } }) as ReturnType<
        ExportArtifacts['readSource']
      >,
    adopt: (request) =>
      send({ kind: 'exportOutput', operation: { method: 'adopt', request } }) as ReturnType<ExportArtifacts['adopt']>,
    claimArtifact: (request) =>
      send({
        kind: 'exportOutput',
        operation: { method: 'artifact', operation: { kind: 'outputClaimArtifact', request } },
      }) as ReturnType<ExportArtifacts['claimArtifact']>,
    recordProgress: (request) =>
      send({
        kind: 'exportOutput',
        operation: { method: 'artifact', operation: { kind: 'outputRecordProgress', request } },
      }) as ReturnType<ExportArtifacts['recordProgress']>,
    beginPublication: (request) =>
      send({
        kind: 'exportOutput',
        operation: { method: 'artifact', operation: { kind: 'outputBeginPublication', request } },
      }) as ReturnType<ExportArtifacts['beginPublication']>,
    recordPublication: (request) =>
      send({
        kind: 'exportOutput',
        operation: { method: 'artifact', operation: { kind: 'outputRecordPublication', request } },
      }) as ReturnType<ExportArtifacts['recordPublication']>,
  };
}

export function exportExecutionClient(send: Send): ExportExecutionStore {
  return {
    finalize: (request) => send({ kind: 'finalizeExport', request }) as ReturnType<ExportExecutionStore['finalize']>,
    scan: (query) => send({ kind: 'scanExportJobs', query }) as ReturnType<ExportExecutionStore['scan']>,
    original: (key) => send({ kind: 'getExportOriginal', key }) as ReturnType<ExportExecutionStore['original']>,
    control: (key) => send({ kind: 'getExportControl', key }) as ReturnType<ExportExecutionStore['control']>,
    claim: (key) => send({ kind: 'claimExport', key }) as ReturnType<ExportExecutionStore['claim']>,
    observe: (request) => send({ kind: 'observeExport', request }) as ReturnType<ExportExecutionStore['observe']>,
  };
}

export function exportJobClient(send: Send): ExportStore {
  return {
    create: (command) => send({ kind: 'exportJob', command }) as ReturnType<ExportStore['create']>,
    cancel: (command) => send({ kind: 'exportJob', command }) as ReturnType<ExportStore['cancel']>,
    get: (key) => send({ kind: 'getExport', key }) as ReturnType<ExportStore['get']>,
    list: (query) => send({ kind: 'listExports', query }) as ReturnType<ExportStore['list']>,
    profiles: (scope) => send({ kind: 'getExportProfiles', scope }) as ReturnType<ExportStore['profiles']>,
  };
}
