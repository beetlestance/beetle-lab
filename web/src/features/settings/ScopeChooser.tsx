import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { SettingsScope } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes, validId } from '../../app/routes.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { ScopeTabs } from './ScopeTabs.js';

interface Choice {
  level: 'organization' | 'workspace';
  organizationId?: string;
}

export function useSettingsChoice(scope: SettingsScope): Choice | undefined {
  const [search] = useSearchParams();
  const level = search.get('level');
  if (scope.kind !== 'installation' || (level !== 'organization' && level !== 'workspace')) return;
  const organizationId = search.get('organization') ?? undefined;
  return level === 'workspace' && validId(organizationId) ? { level, organizationId } : { level };
}

export function SettingsScopeChooser({ level, organizationId }: Choice) {
  const chooseWorkspace = level === 'workspace' && organizationId;
  return (
    <section className="content-section settings-page">
      <header className="settings-header">
        <h1>Settings</h1>
      </header>
      <ScopeTabs scope={{ kind: 'installation' }} choose={level} />
      {chooseWorkspace ? (
        <WorkspaceChoices key={organizationId} organizationId={organizationId} />
      ) : (
        <OrganizationChoices level={level} />
      )}
    </section>
  );
}

function OrganizationChoices({ level }: Pick<Choice, 'level'>) {
  const api = useApi();
  const page = usePage(queryKeys.organizations);
  const query = useQuery({
    queryKey: [...queryKeys.organizations, page.cursor],
    queryFn: ({ signal }) => readResult(api.listOrganizations({ query: page.query, signal })),
  });
  return (
    <div>
      <h2>Choose an organization</h2>
      <QueryState query={query}>
        {({ items, nextCursor }) => (
          <Choices
            items={items}
            href={(id) =>
              level === 'organization' ? routes.organizationSettings(id) : routes.chooseSettings(level, id)
            }
            empty="No organizations yet."
            page={page}
            next={nextCursor}
          />
        )}
      </QueryState>
    </div>
  );
}

function WorkspaceChoices({ organizationId }: { organizationId: string }) {
  const api = useApi();
  const page = usePage(queryKeys.workspaces(organizationId));
  const query = useQuery({
    queryKey: queryKeys.workspacesPage(organizationId, page.cursor),
    queryFn: ({ signal }) => readResult(api.listWorkspaces({ params: { organizationId }, query: page.query, signal })),
  });
  return (
    <div>
      <h2>Choose a workspace</h2>
      <Link to={routes.chooseSettings('workspace')}>Choose another organization</Link>
      <QueryState query={query}>
        {({ items, nextCursor }) => (
          <Choices
            items={items}
            href={(id) => routes.workspaceSettings(organizationId, id)}
            empty="No workspaces in this organization yet."
            page={page}
            next={nextCursor}
          />
        )}
      </QueryState>
    </div>
  );
}

function Choices({
  items,
  href,
  empty,
  page,
  next,
}: {
  items: readonly { id: string; name: string }[];
  href: (id: string) => string;
  empty: string;
  page: ReturnType<typeof usePage>;
  next: string | null;
}) {
  return (
    <>
      {items.length ? (
        <ul>
          {items.map(({ id, name }) => (
            <li key={id}>
              <Link to={href(id)}>{name}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
      {(page.hasBack || next) && <Pagination page={page} next={next} />}
    </>
  );
}
