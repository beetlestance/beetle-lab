import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import type { Budget, InstallationPatch, ScopedOverridePatch, SettingsScope } from '@beetle/contracts/api';
import type { EditorField } from '../../components/Editor.js';
import { useEditor } from '../../components/Editor.js';
import { QueryState } from '../../components/QueryState.js';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { settingsIntent, settingsRead } from './intents.js';
import type { SettingsData } from './intents.js';
import { budgetLabels, integer, numericField, parseRetention, poolLabels, retentionFields, retentionText } from './fields.js';
import './settings.css';

type Patch = InstallationPatch | ScopedOverridePatch;
type Open = (title: string, fields: EditorField[], parse: (values: Readonly<Record<string, string>>) => Patch) => void;
export function Settings({ scope }: { scope: SettingsScope }) {
  const api = useApi();
  const client = useQueryClient();
  const key = scope.kind === 'installation' ? queryKeys.installationSettings : scope.kind === 'organization'
    ? queryKeys.organizationSettings(scope.organizationId) : queryKeys.workspaceSettings(scope.organizationId, scope.workspaceId);
  const identity = JSON.stringify(key);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => readResult(settingsRead(api, scope, signal)) });
  useEffect(() => () => {
    const queryKey: readonly string[] = JSON.parse(identity) as string[];
    void client.cancelQueries({ queryKey, exact: true });
    client.removeQueries({ queryKey, exact: true });
  }, [client, identity]);
  return <QueryState query={query}>{data => <SettingsView data={data} />}</QueryState>;
}
function SettingsView({ data }: { data: SettingsData }) {
  const editor = useEditor();
  const api = useApi();
  const client = useQueryClient();
  const location = useLocation();
  const scope = data.scope;
  const refresh = () => client.invalidateQueries({ queryKey: scope.kind === 'installation' ? queryKeys.settings
    : scope.kind === 'organization' ? queryKeys.organizationSettings(scope.organizationId)
      : queryKeys.workspaceSettings(scope.organizationId, scope.workspaceId) });
  const open: Open = (title, fields, parse) => editor.open(settingsIntent({ api, data, path: location.pathname, title, fields, parse, refresh }));
  return <section className="settings-page">
    <nav className="breadcrumbs" aria-label="Breadcrumb"><Link to={routes.organizations}>Organizations</Link>
      {scope.kind !== 'installation' && <Link to={routes.organization(scope.organizationId)}>Organization</Link>}
      {scope.kind === 'workspace' && <Link to={routes.workspace(scope.organizationId, scope.workspaceId)}>Workspace</Link>}
    </nav>
    <div className="scope-label">{scope.kind} · version {data.version}</div><h1>Settings</h1>
    <p>Defaults apply to future runs. Budget changes do not stop active work.</p>
    {'values' in data && <InstallationGroups data={data} open={open} busy={editor.busy} />}
    <Defaults data={data} open={open} busy={editor.busy} />
    <Retention data={data} open={open} busy={editor.busy} />
  </section>;
}
function Defaults({ data, open, busy }: { data: SettingsData; open: Open; busy: boolean }) {
  const effective = data.effective.runDefaults;
  const overrides = 'overrides' in data ? data.overrides.runDefaults : undefined;
  const installation = 'values' in data;
  const editBudget = (key: keyof Budget) => {
    const leaf = effective.budget[key];
    open(`Edit ${budgetLabels[key]}`, [numericField(key, budgetLabels[key], installation ? leaf.value : overrides?.budget?.[key],
      leaf.allowedRange.minimum, leaf.allowedRange.maximum)], values => {
      const value = integer(values[key] ?? '', leaf.allowedRange.minimum, leaf.allowedRange.maximum);
      return installation ? { runDefaults: { ...data.values.runDefaults, budget: { ...data.values.runDefaults.budget, [key]: value } } }
        : { runDefaults: { budget: { [key]: value } } };
    });
  };
  const editProfile = () => open('Edit engine profile', [{ name: 'engineProfile', label: 'Engine profile',
    value: installation ? effective.engineProfile.value : overrides?.engineProfile ?? '',
    options: [...(!installation && !overrides?.engineProfile ? [''] : []), ...effective.engineProfile.allowedValues],
    help: 'Choose an installed profile. This does not install an image.' }], values => installation
    ? { runDefaults: { ...data.values.runDefaults, engineProfile: values.engineProfile ?? '' } }
    : { runDefaults: { engineProfile: values.engineProfile ?? '' } });
  return <section><h2>Run defaults</h2><div className="settings-table-wrap"><table><caption>Effective defaults and explicit overrides</caption>
    <thead><tr><th>Setting</th><th>Effective / source</th><th>Actual override</th><th>Allowed</th><th>Actions</th></tr></thead>
    <tbody><tr><th>Engine profile</th><td>{effective.engineProfile.value} / {effective.engineProfile.source.kind}</td>
      <td>{installation ? 'Installation value' : overrides?.engineProfile ?? 'Inherited'}</td><td>{effective.engineProfile.allowedValues.join(', ')}</td>
      <td><button disabled={busy} onClick={editProfile}>Edit engine profile</button>
        {!installation && <button disabled={busy} onClick={() => open('Inherit engine profile', [], () => ({ runDefaults: { engineProfile: null } }))}>Inherit engine profile</button>}</td></tr>
      {Object.entries(budgetLabels).map(([name, label]) => { const key = name as keyof Budget; const leaf = effective.budget[key];
        return <tr key={key}><th>{label}</th><td>{leaf.value} / {leaf.source.kind}</td><td>{installation ? 'Installation value' : overrides?.budget?.[key] ?? 'Inherited'}</td>
          <td>{leaf.allowedRange.minimum}–{leaf.allowedRange.maximum}</td><td><button disabled={busy} onClick={() => editBudget(key)}>Edit {label}</button>
            {!installation && <button disabled={busy} onClick={() => open(`Inherit ${label}`, [], () => ({ runDefaults: { budget: { [key]: null } } }))}>Inherit {label}</button>}</td></tr>;
      })}</tbody></table></div></section>;
}
function InstallationGroups({ data, open, busy }: { data: Extract<SettingsData, { values: unknown }>; open: Open; busy: boolean }) {
  return <section><h2>Installation capacity</h2><p>Installed profiles: {data.values.supportedProfiles.join(', ')}. Profile catalogue is read only.</p>
    {(['pool', 'perRunCeilings'] as const).map(group => <div className="settings-group" key={group}>
      <h3>{group === 'pool' ? 'Shared pool limits' : 'Per-run ceilings'}</h3><dl>
        {Object.entries(data.values[group]).map(([key, value]) => <div key={key}><dt>{poolLabels[key as keyof typeof poolLabels]}</dt><dd>{value}</dd></div>)}
      </dl><button disabled={busy} onClick={() => open(`Edit ${group === 'pool' ? 'pool limits' : 'per-run ceilings'}`,
        Object.entries(data.values[group]).map(([key, value]) => numericField(key, poolLabels[key as keyof typeof poolLabels], value, key === 'freeSpaceReserveBytes' ? 0 : 1)),
        values => {
          const parsed = Object.fromEntries(Object.keys(data.values[group]).map(key => [key, integer(values[key] ?? '', key === 'freeSpaceReserveBytes' ? 0 : 1)]));
          return { [group]: parsed } as InstallationPatch;
        })}>Edit {group === 'pool' ? 'pool limits' : 'per-run ceilings'}</button>
    </div>)}
  </section>;
}
function Retention({ data, open, busy }: { data: SettingsData; open: Open; busy: boolean }) {
  const actual = 'values' in data ? data.values.retention : data.overrides.retention;
  return <section><h2>Retention policy</h2><p>Effective: {retentionText(data.effective.retention.value)} · source: {data.effective.retention.source.kind}</p>
    <p>Actual {data.scope.kind === 'installation' ? 'value' : 'override'}: {actual ? retentionText(actual) : 'Inherited'}</p>
    <p>Saving a policy does not delete existing data. Deletion preview and apply are not available here.</p>
    <p>Enabled retention requires at least one age, completed-run count or storage rule. Leave unused criteria blank.</p>
    <button disabled={busy} onClick={() => open('Edit retention policy', retentionFields(actual), values => ({ retention: parseRetention(values) }))}>Edit retention policy</button>
    {data.scope.kind !== 'installation' && <button disabled={busy} onClick={() => open('Inherit retention policy', [], () => ({ retention: null }))}>Inherit retention policy</button>}
  </section>;
}
