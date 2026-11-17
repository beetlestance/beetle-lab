import { Link } from 'react-router-dom';
import { routes } from '../../app/routes.js';
import { EmptyState } from '../../components/States.js';

export type SuiteScriptScope = { organizationId: string; workspaceId: string; suiteId: string; revisionId: string };

/**
 * Script view for one saved suite revision (Penpot boards "Script / revision 1"
 * and its variants). Placeholder owned by Wave 1 package C.
 */
export function SuiteScript({ organizationId, workspaceId, suiteId }: SuiteScriptScope) {
  return (
    <section className="content-section">
      <h1>Script</h1>
      <EmptyState
        title="The script view is not available yet"
        compact
        actions={<Link to={routes.suite(organizationId, workspaceId, suiteId)}>Back to suite</Link>}
      >
        The compiled script for this revision will be shown here.
      </EmptyState>
    </section>
  );
}
