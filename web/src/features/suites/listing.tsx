import { useEffect, useState } from 'react';
import type { FolderSummary, SuiteGroup, Workspace } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { NavTabs } from '../../components/Tabs.js';

/** Workspace section tabs shown on the Suites boards; Suites is current. */
export function WorkspaceTabs({ workspace }: { workspace: Workspace }) {
  const org = workspace.scope.organizationId;
  return (
    <NavTabs
      label="Workspace sections"
      items={[
        { to: routes.suites(org, workspace.id), label: 'Suites', current: true },
        { to: routes.runs(org, workspace.id), label: 'Runs', current: false },
        { to: routes.inputs(org, workspace.id), label: 'Inputs', current: false },
        { to: routes.workspaceSettings(org, workspace.id), label: 'Settings', current: false },
      ]}
    />
  );
}
export function useDebounced<T>(value: T, ms = 300): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return current;
}
/** Suite-name search needs 3 to 64 characters (server rule); shorter text is not sent. */
export function searchTerm(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed.length >= 3 && trimmed.length <= 64 ? trimmed : undefined;
}
const mixOrder: readonly [SuiteGroup, string][] = [
  ['passed', 'passed'],
  ['failed', 'failed'],
  ['inconclusive', 'inconclusive'],
  ['stopped', 'stopped'],
  ['in_progress', 'in progress'],
  ['no_runs', 'with no runs'],
];
/** "16 passed, 2 failed, 1 in progress, 1 with no runs", "All 12 passed", "No suites yet". */
export function mixText(summary: FolderSummary): string {
  const { suiteCount, groups, subfolderCount } = summary;
  const parts =
    suiteCount === 0
      ? ['No suites yet']
      : groups.passed === suiteCount
        ? [`All ${suiteCount} passed`]
        : groups.no_runs === suiteCount
          ? [suiteCount === 1 ? 'No runs yet' : `None of ${suiteCount} has run yet`]
          : [
              mixOrder
                .filter(([group]) => groups[group] > 0)
                .map(([group, label]) => `${groups[group]} ${label}`)
                .join(', '),
            ];
  const sentence = parts.join('');
  if (!subfolderCount) return sentence;
  return `${sentence}. Has ${subfolderCount} ${subfolderCount === 1 ? 'subfolder' : 'subfolders'}.`;
}
export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}
