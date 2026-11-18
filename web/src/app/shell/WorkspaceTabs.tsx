import { routes } from '../routes.js';
import { NavTabs } from '../../components/Tabs.js';

export type WorkspaceSection = 'overview' | 'suites' | 'runs' | 'inputs' | 'exports' | 'settings';

/** The one workspace section bar: Suites, Runs, Inputs, Exports and Settings. */
export function WorkspaceTabs({
  organizationId,
  workspaceId,
  current,
}: {
  organizationId: string;
  workspaceId: string;
  current: WorkspaceSection;
}) {
  const items = [
    { to: routes.suites(organizationId, workspaceId), label: 'Suites', current: current === 'suites' },
    { to: routes.runs(organizationId, workspaceId), label: 'Runs', current: current === 'runs' },
    { to: routes.inputs(organizationId, workspaceId), label: 'Inputs', current: current === 'inputs' },
    { to: routes.exports(organizationId, workspaceId), label: 'Exports', current: current === 'exports' },
    { to: routes.workspaceSettings(organizationId, workspaceId), label: 'Settings', current: current === 'settings' },
  ];
  return <NavTabs label="Workspace sections" items={items} />;
}
