import { DeleteNamespace } from '../namespace-deletion/index.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import type { Organization } from '@beetle/contracts/api';
import type { EditorField } from '../../components/Editor.js';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { useEditor } from '../../components/Editor.js';
import { usePage, Pagination } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { ResourceTable } from '../../components/ResourceTable.js';

/** Mirrors contracts/api/v2/common OrganizationName. */
const ORGANIZATION_NAME_MAX = 48;

function organizationFields(org?: Organization): EditorField[] {
  return [
    {
      name: 'name',
      label: 'Organization name',
      value: org?.name ?? '',
      maxLength: ORGANIZATION_NAME_MAX,
      help: `Up to ${ORGANIZATION_NAME_MAX} characters.`,
    },
    {
      name: 'slug',
      label: 'Organization slug',
      value: org?.slug ?? '',
      pattern: '[a-z0-9]+(-[a-z0-9]+)*',
      help: 'Lowercase letters, numbers, and single hyphens.',
    },
  ];
}

export function Organizations({ workspaceDirectory = false }: { workspaceDirectory?: boolean }) {
  const api = useApi();
  const client = useQueryClient();
  const editor = useEditor();
  const { pathname } = useLocation();
  const page = usePage(queryKeys.organizations);
  const query = useQuery({
    queryKey: [...queryKeys.organizations, page.cursor],
    queryFn: ({ signal }) => readResult(api.listOrganizations({ query: page.query, signal })),
  });
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.organizations });
  function edit(org?: Organization) {
    editor.open({
      title: org ? 'Rename organization' : 'Create organization',
      path: pathname,
      fields: organizationFields(org),
      submit: (values, requestId) => {
        const body = { requestId, scope: { kind: 'installation' as const }, name: values.name!, slug: values.slug! };
        if (!org) return api.createOrganization({ body });
        // Omit an unchanged name so an organisation created before the 48-character limit can still change its slug.
        const { name, ...rest } = body;
        return api.patchOrganization({
          params: { organizationId: org.id },
          body: { ...rest, ...(name.trim() === org.name ? {} : { name }), expectedVersion: org.version },
        });
      },
      refresh,
    });
  }
  return (
    <section className="content-section">
      <header className="section-header">
        <div>
          <p className="eyebrow">Installation</p>
          <h1>{workspaceDirectory ? 'Workspaces' : 'Organizations'}</h1>
          <p>
            {workspaceDirectory
              ? 'Choose an organization to see its workspaces.'
              : 'Keep each company or client’s work in its own namespace.'}
          </p>
        </div>
        <button className="primary" disabled={editor.busy} onClick={() => edit()}>
          Create organization
        </button>
      </header>
      <QueryState query={query}>
        {(data) => (
          <>
            <ResourceTable
              title="Organizations"
              headings={['Organization', 'Slug', 'Version', 'Actions']}
              empty={!data.items.length}
            >
              {data.items.map((org) => (
                <tr key={org.id}>
                  <th scope="row">
                    <Link to={workspaceDirectory ? routes.organizationWorkspaces(org.id) : routes.organization(org.id)}>
                      {org.name}
                    </Link>
                  </th>
                  <td>{org.slug}</td>
                  <td className="number">{org.version}</td>
                  <td>
                    <button aria-label={`Rename ${org.name}`} disabled={editor.busy} onClick={() => edit(org)}>
                      Rename
                    </button>
                    <DeleteNamespace target={{ kind: 'organization', entity: org }} refresh={refresh} />
                  </td>
                </tr>
              ))}
            </ResourceTable>
            <Pagination page={page} next={data.nextCursor} />
          </>
        )}
      </QueryState>
    </section>
  );
}
