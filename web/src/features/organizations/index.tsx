import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import type { Organization } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { useEditor } from '../../components/Editor.js';
import { usePage, Pagination } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { ResourceTable } from '../../components/ResourceTable.js';

export function Organizations() {
  const api = useApi();
  const client = useQueryClient();
  const editor = useEditor();
  const { pathname } = useLocation();
  const page = usePage(queryKeys.organizations);
  const query = useQuery({ queryKey: [...queryKeys.organizations, page.cursor],
    queryFn: ({ signal }) => readResult(api.listOrganizations({ query: page.query, signal })) });
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.organizations });
  function edit(org?: Organization) {
    editor.open({ title: org ? 'Rename organization' : 'Create organization', path: pathname,
      fields: [{ name: 'name', label: 'Organization name', value: org?.name ?? '' },
        { name: 'slug', label: 'Organization slug', value: org?.slug ?? '', pattern: '[a-z0-9]+(-[a-z0-9]+)*', help: 'Lowercase letters, numbers, and single hyphens.' }],
      submit: (values, requestId) => {
        const body = { requestId, scope: { kind: 'installation' as const }, name: values.name!, slug: values.slug! };
        return org ? api.patchOrganization({ params: { organizationId: org.id }, body: { ...body, expectedVersion: org.version } })
          : api.createOrganization({ body });
      }, refresh });
  }
  return <section className="content-section">
    <header className="section-header"><div><p className="eyebrow">Installation</p><h1>Organizations</h1>
      <p>Keep each company or client’s work in its own namespace.</p></div>
      <button className="primary" disabled={editor.busy} onClick={() => edit()}>Create organization</button></header>
    <QueryState query={query}>{data => <>
      <ResourceTable title="Organizations" headings={['Organization', 'Slug', 'Version', 'Actions']} empty={!data.items.length}>
        {data.items.map(org => <tr key={org.id}>
          <th scope="row"><Link to={routes.organization(org.id)}>{org.name}</Link></th><td>{org.slug}</td><td className="number">{org.version}</td>
          <td><button aria-label={`Rename ${org.name}`} disabled={editor.busy} onClick={() => edit(org)}>Rename</button></td>
        </tr>)}
      </ResourceTable><Pagination page={page} next={data.nextCursor} />
    </>}</QueryState>
  </section>;
}
