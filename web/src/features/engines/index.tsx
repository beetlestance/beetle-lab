import { EmptyState } from '../../components/States.js';

/**
 * Engines page (Penpot board "Engines"). Placeholder owned by Wave 1 package F:
 * the public API has no engine inventory read yet, so nothing is listed.
 */
export function Engines() {
  return (
    <section className="content-section">
      <h1>Engines</h1>
      <EmptyState title="Engine inventory is not available yet" compact>
        This build has no engine inventory endpoint, so installed engines and their images cannot be listed here.
      </EmptyState>
    </section>
  );
}
