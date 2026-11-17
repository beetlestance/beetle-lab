import { captureSettingsIdentity, captureSettingsRecord } from './settings-row.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SettingsScope, RunDefaults, WorkspaceScope } from '@beetle/contracts/api';
import {
  resolveRunSettings,
  decideSettingsChange,
  resolveEffectiveSettings,
  validateInstallation,
} from '../../../domain/settings/index.js';
import type {
  InstallationRecord,
  OrganizationRecord,
  WorkspaceRecord,
  SettingsRecord,
  SettingsChain,
  RuntimeCeilings,
} from '../../../domain/settings/index.js';
import { immutableSnapshot, requireRule } from '../../../domain/namespaces/index.js';
import type { SettingsCommand, SettingsChange } from '../../../ports/settings.js';
import type { SettingsIdentity } from '../../../ports/settings-reader.js';
import { lower, scopeKey, boundedCopy } from './input.js';
import type { Bootstrap, RuntimeObservation, SettingsView } from './protocol.js';
import { RuntimeCapacity } from './runtime.js';

export class Settings {
  private readonly runtime: RuntimeCapacity;
  constructor(
    private readonly db: DatabaseSync,
    bootstrap: Bootstrap,
  ) {
    this.runtime = new RuntimeCapacity(bootstrap);
    const existing = db.prepare("SELECT id FROM settings WHERE scope_key='installation'").get();
    if (existing) requireRule(existing.id === lower(bootstrap.installation.id), 'conflict');
    else {
      const runtime = this.runtime.snapshot();
      if (runtime !== null) validateInstallation(bootstrap.installation.values, runtime);
      this.insert(bootstrap.installation);
    }
  }
  updateRuntime(runtime: RuntimeObservation | null): null {
    return this.runtime.update(runtime);
  }
  /** Claim reads current policy with the original cache lease; no new observation. */
  capacity(): Readonly<{ installation: InstallationRecord; runtime: Readonly<RuntimeObservation> | null }> {
    const installation = immutableSnapshot(this.record({ kind: 'installation' }) as InstallationRecord);
    return Object.freeze({ installation, runtime: this.runtime.currentObservation() });
  }
  insert(record: SettingsRecord): void {
    const scope = record.scope;
    const organization = scope.kind === 'installation' ? null : lower(scope.organizationId);
    const workspace = scope.kind === 'workspace' ? lower(scope.workspaceId) : null;
    this.db
      .prepare(
        `INSERT INTO settings(scope_key,id,kind,organization_id,workspace_id,version,value_json)
      VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        scopeKey(scope),
        lower(record.id),
        scope.kind,
        organization,
        workspace,
        record.version,
        JSON.stringify('values' in record ? record.values : record.overrides),
      );
  }
  createOverrides(scope: Exclude<SettingsScope, { kind: 'installation' }>): void {
    const common = { id: randomUUID(), version: 1, schemaVersion: 2 as const, overrides: {} };
    if (scope.kind === 'organization') this.insert({ ...common, scope });
    else this.insert({ ...common, scope });
  }
  private record(scope: SettingsScope): SettingsRecord {
    const row = this.db
      .prepare(
        `SELECT id,version,kind,organization_id,workspace_id,
      CASE WHEN typeof(value_json)='text' AND length(CAST(value_json AS BLOB))<=32768
        THEN value_json ELSE NULL END AS value_json FROM settings WHERE scope_key=?`,
      )
      .get(scopeKey(scope));
    requireRule(row !== undefined, 'not_found');
    return captureSettingsRecord(row, scope);
  }

  chain(scope: SettingsScope): SettingsChain {
    const installation = this.record({ kind: 'installation' }) as InstallationRecord;
    if (scope.kind === 'installation') return { installation };
    const organization = this.record({
      kind: 'organization',
      organizationId: scope.organizationId,
    }) as OrganizationRecord;
    if (scope.kind === 'organization') return { installation, organization };
    const workspace = this.record(scope) as WorkspaceRecord;
    return { installation, organization, workspace };
  }
  resolveRun(scope: WorkspaceScope, run: RunDefaults) {
    const chain = this.chain(scope);
    const resolved = resolveRunSettings({ scope, chain, runtime: this.runtime.snapshot(), run });
    requireRule(chain.organization !== undefined && chain.workspace !== undefined, 'not_found');
    return {
      defaults: resolved.defaults,
      versions: {
        installation: chain.installation.version,
        organization: chain.organization.version,
        workspace: chain.workspace.version,
      },
    };
  }
  identity(scope: SettingsScope): SettingsIdentity {
    const row = this.db
      .prepare('SELECT id,kind,organization_id,workspace_id FROM settings WHERE scope_key=?')
      .get(scopeKey(scope));
    requireRule(row !== undefined, 'not_found');
    return captureSettingsIdentity(row, scope);
  }

  get(scope: SettingsScope): SettingsView {
    const chain = this.chain(scope);
    const record =
      scope.kind === 'installation'
        ? chain.installation
        : scope.kind === 'organization'
          ? chain.organization!
          : chain.workspace!;
    const effective = resolveEffectiveSettings({ scope: record.scope, chain, runtime: this.runtime.snapshot() });
    return { ...record, effective };
  }
  change(command: SettingsCommand): SettingsChange {
    return this.changeWithCeilings(command, this.runtime.snapshot());
  }
  /** Offline caller owns startup exclusion and has validated installed policy, not a host observation. */
  changeOffline(command: SettingsCommand, ceilings: RuntimeCeilings): SettingsChange {
    return this.changeWithCeilings(command, ceilings);
  }
  private changeWithCeilings(command: SettingsCommand, runtime: RuntimeCeilings | null): SettingsChange {
    const change = decideSettingsChange(command, { chain: this.chain(command.request.scope), runtime });
    const record = change.settings;
    const values = 'values' in record ? record.values : record.overrides;
    boundedCopy(values, 32768);
    this.db
      .prepare('UPDATE settings SET version=?,value_json=? WHERE scope_key=?')
      .run(record.version, JSON.stringify(values), scopeKey(record.scope));
    return change;
  }
}
