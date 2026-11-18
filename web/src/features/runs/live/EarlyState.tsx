import startingArt from '../../../assets/illustrations/starting.svg';
import './early.css';
/** Decorative exported Penpot art; progress and placeholders never claim measured work. */
export function EarlyArt() {
  return <img className="live-early-art" src={startingArt} width="560" height="392" alt="" />;
}
export function EarlyMeter() {
  return (
    <div className="live-early-meter" role="progressbar" aria-label="Waiting for live metrics">
      <span />
    </div>
  );
}
export function EarlyMetricsSkeleton() {
  return (
    <div className="skeleton-cards live-early-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div className="skeleton-card" key={index}>
          {[120, 220, null, 180].map((width, i) => (
            <div
              className="skeleton-bar"
              key={i}
              style={{ width: width === null ? '100%' : `min(${width}px,100%)`, height: i === 1 ? 22 : 12 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
