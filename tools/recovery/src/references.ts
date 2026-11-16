import type { WorkspaceScope, Run } from '@beetle/contracts/api';
import type { RecoveryEntry, RecoveryHeader } from '@beetle/contracts/recovery';
import { Metadata } from '../../../app/src/adapters/outbound/sqlite/index.js';
import type { MetadataOptions } from '../../../app/src/adapters/outbound/sqlite/index.js';
import { outputPublicationPath } from '../../../app/src/adapters/outbound/files/outputs/index.js';
import { inputPublicationPath } from '../../../app/src/adapters/outbound/files/inputs/index.js';
import type { RecoveryIO } from './io.js';
import { child } from './files.js';
import { RecoveryError } from './types.js';
/** Reuse bounded owning readers; no parallel SQL reimplementation of artifact mappings. */
export async function verifyReferences(io: RecoveryIO, root: string, header: RecoveryHeader, entries: readonly RecoveryEntry[], settings: {options: MetadataOptions; maximum: number}): Promise<void> {
  const owner = await io.acquire(() => Metadata.open({...settings.options, path: child(root, header.roles.metadata), readOnly: true, runtime: null}), db => db.close());
  try {await new References(io, owner.value, header, entries, settings.maximum).scan();} finally {await io.close(owner);}
}
class References {
  private readonly entries: Map<string, RecoveryEntry>; private count = 0;
  constructor(private readonly io: RecoveryIO, private readonly db: Metadata, private readonly header: RecoveryHeader,
    entries: readonly RecoveryEntry[], private readonly maximum: number) {this.entries = new Map(entries.map(entry => [entry.path, entry]));}
  private tick(): void {this.io.check(); if (++this.count > this.maximum) throw new RecoveryError('limit');}
  private match(root: string | null, path: string, bytes: number, sha256: string): void {
    this.tick(); const entry = root === null ? undefined : this.entries.get(root + '/' + path);
    if (entry?.kind !== 'file' || entry.bytes !== bytes || entry.sha256 !== sha256) throw new RecoveryError('integrity');
  }
  async scan(): Promise<void> {
    let cursor: string | undefined;
    do {
      this.tick(); const page = await this.db.list({kind: 'organization', scope: {kind: 'installation'}, limit: 100, ...(cursor ? {cursor} : {})});
      for (const item of page.items) {this.tick(); await this.organization(item.id);}
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  private async organization(organizationId: string): Promise<void> {
    let cursor: string | undefined;
    do {
      this.tick(); const page = await this.db.list({kind: 'workspace', scope: {kind: 'organization', organizationId}, limit: 100, ...(cursor ? {cursor} : {})});
      for (const item of page.items) {this.tick(); await this.workspace({kind: 'workspace', organizationId, workspaceId: item.id});}
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  private async workspace(scope: WorkspaceScope): Promise<void> {await this.inputs(scope); await this.runs(scope); await this.exports(scope);}
  private async inputs(scope: WorkspaceScope): Promise<void> {
    let cursor: string | undefined;
    do {
      this.tick(); const page = await this.db.inputs.list({scope, limit: 100, ...(cursor ? {cursor} : {})});
      for (const input of page.items) {this.tick(); if (input.state === 'published') this.match(this.header.roles.inputs, inputPublicationPath(input), input.bytes, input.sha256);}
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  private async runs(scope: WorkspaceScope): Promise<void> {
    let cursor: string | undefined;
    do {
      this.tick(); const page = await this.db.runs.listRuns({scope, limit: 100, ...(cursor ? {cursor} : {})});
      for (const run of page.items) {
        this.tick();
        try {await this.artifacts(run);}
        catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'not_found')) throw error;}
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  private async artifacts(run: Run): Promise<void> {
    let cursor: string | undefined;
    do {
      this.tick(); const key = {id: run.id, scope: run.scope, attemptId: run.activeAttemptId};
      const page = await this.db.runArtifacts.listRunArtifacts({...key, limit: 100, ...(cursor ? {cursor} : {})});
      for (const item of page.items) {
        const {record} = await this.db.runArtifacts.getRunArtifact({...key, artifactId: item.artifactId});
        this.match(this.header.roles.outputs, outputPublicationPath(record), item.bytes, item.sha256);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  private async exports(scope: WorkspaceScope): Promise<void> {
    let cursor: string | undefined;
    do {
      this.tick(); const page = await this.db.exports.list({scope, limit: 100, ...(cursor ? {cursor} : {})});
      for (const job of page.items) {
        this.tick(); if (job.state !== 'ready') continue;
        const record = await this.db.exportOutputs.published({scope, id: job.id});
        this.match(this.header.roles.outputs, outputPublicationPath(record), record.artifact.bytes, record.artifact.sha256);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
}
