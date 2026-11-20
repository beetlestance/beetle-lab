import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { SettingsScope } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { ScopeTabs } from './ScopeTabs.js';

/** Organization settings entered from the installation level pick an organization first. */
export function useSettingsChoice(scope: SettingsScope): boolean {
  const [search] = useSearchParams();
  return scope.kind === 'installation' && search.get('level') === 'organization';
}

export function SettingsScopeChooser() {
  return (
    <section className="content-section settings-page">
      <header className="settings-header">
        <h1>Settings</h1>
      </header>
      <ScopeTabs scope={{ kind: 'installation' }} choose="organization" />
      <OrganizationChoices />
    </section>
  );
}

function OrganizationChoices() {
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
            href={(id) => routes.organizationSettings(id)}
            empty="No organizations yet."
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
