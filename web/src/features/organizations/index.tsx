import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { Organization } from '@beetle/contracts/api';
import type { EditorField } from '../../components/Editor.js';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { useRememberedSettingsScope } from '../../app/settings-scope.js';
import { Button } from '../../components/Button.js';
import { useEditor } from '../../components/Editor.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState, LoadingState } from '../../components/States.js';

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
      conflict: (slug) => `“${slug}” is taken by another organization. Choose a different slug.`,
    },
  ];
}

/**
 * Create and rename share one dialog. A created organization opens its overview, so the
 * header switcher is the only organization list the app needs.
 */
export function useOrganizationEditor() {
  const api = useApi();
  const client = useQueryClient();
  const editor = useEditor();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const refreshLists = () => client.invalidateQueries({ queryKey: queryKeys.organizations });
  function create() {
    let created: string | undefined;
    editor.open({
      title: 'Create organization',
      path: pathname,
      fields: organizationFields(),
      submit: async (values, requestId) => {
        const reply = await api.createOrganization({
          body: { requestId, scope: { kind: 'installation' }, name: values.name!, slug: values.slug! },
        });
        if (reply.ok) created = reply.value.id;
        return reply;
      },
      refresh: async () => {
        await refreshLists();
        if (created) void navigate(routes.organization(created));
      },
    });
  }
  function rename(org: Organization) {
    editor.open({
      title: 'Rename organization',
      path: pathname,
      fields: organizationFields(org),
      submit: (values, requestId) =>
        api.patchOrganization({
          params: { organizationId: org.id },
          body: {
            requestId,
            scope: { kind: 'installation' },
            slug: values.slug!,
            // Omit an unchanged name so an organisation created before the 48-character limit can still change its slug.
            ...(values.name!.trim() === org.name ? {} : { name: values.name! }),
            expectedVersion: org.version,
          },
        }),
      refresh: () =>
        Promise.all([refreshLists(), client.invalidateQueries({ queryKey: queryKeys.organization(org.id) })]),
    });
  }
  return { create, rename, busy: editor.busy };
}

/**
 * `/` and `/workspaces` open an organization: the one in use this session if it still
 * exists, otherwise the first listed. With none, the first-run screen offers to create one.
 */
export function Home({ to }: { to: 'overview' | 'workspaces' }) {
  const api = useApi();
  const remembered = useRememberedSettingsScope().organizationId;
  const query = useQuery({
    queryKey: [...queryKeys.organizations, 'home'],
    queryFn: ({ signal }) => readResult(api.listOrganizations({ query: { limit: 20 }, signal })),
  });
  return (
    <QueryState query={query} loading={<LoadingState variant="page" label="Opening your organization…" />}>
      {({ items }) => {
        const chosen = items.find((org) => org.id === remembered) ?? items[0];
        if (!chosen) return <FirstOrganization />;
        const target = to === 'workspaces' ? routes.organizationWorkspaces(chosen.id) : routes.organization(chosen.id);
        return <Navigate replace to={target} />;
      }}
    </QueryState>
  );
}

function FirstOrganization() {
  const editor = useOrganizationEditor();
  return (
    <section className="content-section">
      <EmptyState
        headingLevel={1}
        title="Create your first organization"
        actions={
          <Button variant="primary" disabled={editor.busy} onClick={editor.create}>
            Create organization
          </Button>
        }
      >
        An organization keeps one company or client’s workspaces, suites and runs together. You can add more later from
        the organization menu in the header.
      </EmptyState>
    </section>
  );
}
