import { LoadingState } from '../../components/States.js';

/** The Overview / Loading board reserves the final screen's space without invented values. */
export function OverviewLoading() {
  return (
    <div className="overview-loading" role="status" aria-busy="true">
      <span className="sr-only">Loading workspace overview…</span>
      <div className="overview-loading-title" aria-hidden="true">
        <div className="skeleton-bar skeleton-title" />
        <div className="skeleton-bar overview-loading-lede" />
        <div className="skeleton-bar overview-loading-caption" />
      </div>
      <div className="skeleton-cards" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <div className="skeleton-bar overview-loading-label" />
            <div className="skeleton-bar overview-loading-value" />
            <div className="skeleton-bar" />
            <div className="skeleton-bar" />
          </div>
        ))}
      </div>
      <div aria-hidden="true">
        <div className="overview-loading-columns">
          <span>Result</span>
          <span>Suite</span>
          <span>Started</span>
          <span>p95</span>
        </div>
        <LoadingState variant="table" rows={5} label="Loading recent runs…" />
      </div>
    </div>
  );
}
