import type { FolderPage, Workspace } from '@beetle/contracts/api';
import { useSessionAccess } from '../../app/session.js';
import { Button } from '../../components/Button.js';
import { LoadingState } from '../../components/States.js';
import suiteArt from '../../assets/illustrations/suite.svg';
import './states.css';

/** Empty means the complete folder inventory proves that the root has no suites. */
export function emptySuiteInventory(page: FolderPage | undefined, workspace: Workspace): boolean {
  if (!page || page.nextCursor !== null || !page.summaries) return false;
  const root = workspace.rootFolderId.toLowerCase();
  return (
    page.items.every((folder) => folder.id.toLowerCase() === root) &&
    page.summaries.some((summary) => summary.folderId.toLowerCase() === root && summary.suiteCount === 0)
  );
}
export function SuitesEmpty({ create }: { create: () => void }) {
  const { readOnly } = useSessionAccess();
  return (
    <section className="suites-empty" aria-labelledby="suites-empty-title">
      <div className="suites-empty-text">
        <h2 id="suites-empty-title">No suites here yet</h2>
        <p className="suites-empty-lede">
          A suite is the plan for a run: the target, the requests and their checks, how load arrives, and the limits
          that decide pass or fail. Every save becomes a revision you can run and compare.
        </p>
        <div>
          <Button variant="primary" disabled={readOnly} onClick={create}>
            Write a suite
          </Button>
        </div>
        <p className="suites-empty-note">You can also paste a complete configuration as JSON once the suite exists.</p>
      </div>
      <img className="suites-empty-art" src={suiteArt} width="560" height="392" alt="" />
    </section>
  );
}
/** A direct-folder summary proves emptiness without confusing it with a filtered page. */
export function FolderEmpty({ name, create }: { name: string; create: () => void }) {
  const { readOnly } = useSessionAccess();
  return (
    <section className="suites-empty" aria-labelledby="folder-empty-title">
      <div className="suites-empty-text">
        <h2 id="folder-empty-title">No suites in {name} yet</h2>
        <p className="suites-empty-lede">
          Add a suite here to keep it with the others for this service. Inputs stay shared across the whole workspace,
          so any suite can use them.
        </p>
        <div>
          <Button variant="primary" disabled={readOnly} onClick={create}>
            New suite in {name}
          </Button>
        </div>
        <p className="suites-empty-note">Folders only group suites. They never change how a run executes.</p>
      </div>
      <img className="suites-empty-art" src={suiteArt} width="560" height="392" alt="" />
    </section>
  );
}
/** The loading board has one accessible announcement; every skeleton is decorative. */
export function SuitesLoading() {
  return (
    <section className="suites-loading" role="status" aria-busy="true">
      <span className="sr-only">Loading suites…</span>
      <div className="suites-loading-intro" aria-hidden="true">
        <div className="skeleton-bar suites-loading-title" />
        <div className="skeleton-bar suites-loading-lede" />
        <div className="skeleton-bar suites-loading-caption" />
      </div>
      <div className="suites-loading-body" aria-hidden="true">
        <div>
          <div className="suites-loading-columns">
            <span>Result</span>
            <span>Suite</span>
            <span>Started</span>
            <span>p95</span>
          </div>
          <LoadingState variant="table" rows={6} />
        </div>
        <div className="suites-loading-cards">
          {[0, 1].map((index) => (
            <div className="suites-loading-card" key={index}>
              <div className="skeleton-bar suites-loading-label" />
              <div className="skeleton-bar suites-loading-value" />
              <div className="skeleton-bar" />
              <div className="skeleton-bar suites-loading-detail" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
