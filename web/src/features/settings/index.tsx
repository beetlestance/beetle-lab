import { useCallback, useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import type { SettingsScope } from '@beetle/contracts/api';
import { QueryState } from '../../components/QueryState.js';
import { LoadingState } from '../../components/States.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { validId } from '../../app/routes.js';
import { RetireWorkspace } from '../namespace-deletion/Retire.js';
import { ParentRetentionControls } from '../retention/Parent.js';
import { RetentionControls } from '../retention/index.js';
import { Capacity } from './Capacity.js';
import { settingsRead } from './intents.js';
import type { SettingsData } from './intents.js';
import type { DraftValue, RowFacts } from './model.js';
import { budgetRows, installationRows, profileRow, retentionRow } from './model.js';
import { buildPatch } from './patch.js';
import { SettingRow } from './Row.js';
import { ChangedElsewhere, SaveBar, SaveFailure } from './SaveBar.js';
import { ScopeTabs, useScopeName } from './ScopeTabs.js';
import { useDraft, useSave } from './useSave.js';
import type { SavePhase } from './useSave.js';
import './settings.css';

function settingsKey(scope: SettingsScope): readonly string[] {
  if (scope.kind === 'installation') return queryKeys.installationSettings;
  if (scope.kind === 'organization') return queryKeys.organizationSettings(scope.organizationId);
  return queryKeys.workspaceSettings(scope.organizationId, scope.workspaceId);
}

export function Settings({ scope }: { scope: SettingsScope }) {
  const api = useApi();
  const client = useQueryClient();
  const key = settingsKey(scope);
  const identity = JSON.stringify(key);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => readResult(settingsRead(api, scope, signal)) });
  useEffect(
    () => () => {
      const queryKey: readonly string[] = JSON.parse(identity) as string[];
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    },
    [client, identity],
  );
  return (
    <QueryState query={query} loading={<LoadingState label="Loading settings…" variant="cards" rows={6} />}>
      {(data) => <SettingsView data={data} />}
    </QueryState>
  );
}

const intro =
  'Each setting is inherited from installation to organization to workspace. Set a value to override what comes from above, or inherit again. Each level saves on its own, and a run keeps the values it started with.';
const capacityIntro =
  'Capacity every run on this installation shares. A run that does not fit waits in the queue; nothing running is ever stopped to make room.';

function useSettingsForm(data: SettingsData) {
  const client = useQueryClient();
  const scope = data.scope;
  const { draft, change, clear } = useDraft(settingsKey(scope));
  // Parent writes refresh every descendant level that inherits from them.
  const refresh = useCallback(() => {
    const queryKey =
      scope.kind === 'installation'
        ? queryKeys.settings
        : scope.kind === 'organization'
          ? queryKeys.organizationSettings(scope.organizationId)
          : queryKeys.workspaceSettings(scope.organizationId, scope.workspaceId);
    return client.invalidateQueries({ queryKey });
  }, [client, scope]);
  const save = useSave(refresh, clear);
  const built = buildPatch(data, draft);
  const pending = save.state.phase === 'pending';
  const rowProps = (row: RowFacts): ComponentProps<typeof SettingRow> => ({
    row,
    value: draft[row.id],
    error: built.errors[row.id],
    disabled: pending,
    onChange: (value: DraftValue | undefined) => {
      change(row.id, value);
      if (!pending) save.reset();
    },
  });
  const discard = () => {
    clear();
    save.reset();
  };
  return { draft, built, save, rowProps, refresh, discard };
}

function SettingsView({ data }: { data: SettingsData }) {
  const name = useScopeName(data.scope);
  const [view, setView] = useState<'limits' | 'capacity'>('limits');
  const form = useSettingsForm(data);
  const { save, built } = form;
  const count = Object.keys(form.draft).length;
  const installation = 'values' in data ? data : undefined;
  const capacity = installation && view === 'capacity';
  return (
    <section className="content-section settings-page">
      <header className="settings-header">
        <h1>Settings</h1>
        <p>{capacity ? capacityIntro : intro}</p>
      </header>
      <ScopeTabs scope={data.scope} />
      {installation && <ViewSwitch view={view} onChange={setView} />}
      <p className="settings-editing">
        Editing <strong>{editingLabel(!!capacity, name)}</strong>.
      </p>
      {capacity ? (
        <Capacity data={installation} rowProps={form.rowProps} />
      ) : (
        <LimitRows data={data} name={name} rowProps={form.rowProps} />
      )}
      <SaveFailure state={save.state} onReplay={save.replay} />
      <SaveBar
        name={name}
        count={count}
        invalid={Object.keys(built.errors).length}
        state={save.state}
        onDiscard={form.discard}
        onSave={() => built.patch && save.save(data, built.patch)}
      />
      {isConflict(save.state) && (
        <ChangedElsewhere
          name={name}
          count={count}
          onClose={save.reset}
          onReload={() => void form.refresh().then(save.reset)}
        />
      )}
      {!capacity && <Retention data={data} />}
    </section>
  );
}

function editingLabel(capacity: boolean, name: string): string {
  if (capacity) return 'shared capacity';
  return name === 'installation' ? 'this installation' : name;
}

function isConflict(state: SavePhase): boolean {
  return state.phase === 'failed' && state.failure.protocol?.code === 'conflict';
}

function ViewSwitch({
  view,
  onChange,
}: {
  view: 'limits' | 'capacity';
  onChange: (view: 'limits' | 'capacity') => void;
}) {
  return (
    <SegmentedFilter
      label="Installation settings"
      value={view}
      onChange={onChange}
      options={[
        { value: 'limits', label: 'Run limits' },
        { value: 'capacity', label: 'Shared capacity' },
      ]}
    />
  );
}

function LimitRows({
  data,
  name,
  rowProps,
}: {
  data: SettingsData;
  name: string;
  rowProps: (row: RowFacts) => ComponentProps<typeof SettingRow>;
}) {
  return (
    <ul className="setting-rows" aria-label={`Settings for ${name}`}>
      {'values' in data && <SettingRow {...rowProps(installationRows(data).admin)} />}
      {budgetRows(data).map((row) => (
        <SettingRow key={row.id} {...rowProps(row)} />
      ))}
      <SettingRow {...rowProps(profileRow(data))} />
      <SettingRow {...rowProps(retentionRow(data))} />
    </ul>
  );
}

function Retention({ data }: { data: SettingsData }) {
  const location = useLocation();
  const scope = data.scope;
  const requestedBatch = new URLSearchParams(location.search).get('retentionBatch');
  const batch = requestedBatch && validId(requestedBatch) ? requestedBatch : undefined;
  if (scope.kind === 'workspace')
    return (
      <>
        <RetentionControls
          key={`${scope.organizationId}/${scope.workspaceId}/${batch ?? ''}`}
          scope={scope}
          {...(batch ? { initialSnapshotId: batch } : {})}
        />
        <RetireWorkspace organizationId={scope.organizationId} workspaceId={scope.workspaceId} />
      </>
    );
  return (
    <ParentRetentionControls key={JSON.stringify(scope)} scope={scope} settingsId={data.id} version={data.version} />
  );
}
