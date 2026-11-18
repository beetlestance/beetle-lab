/** A keyboard-operable optional configuration toggle, styled as the design's title badge. */
export function OptionalTitle({
  title,
  label,
  enabled,
  toggle,
}: {
  title: string;
  label: string;
  enabled: boolean;
  toggle: (enabled: boolean) => void;
}) {
  return (
    <span className="optional-title">
      {title}
      <label className="optional-toggle">
        <input
          className="sr-only"
          type="checkbox"
          aria-label={label}
          checked={enabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        <span aria-hidden="true">{enabled ? 'Optional' : 'Off'}</span>
      </label>
    </span>
  );
}
