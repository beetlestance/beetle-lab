/** Display formatting only; no unit conversion of source-reported values. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function wallTime(value: string | number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function dateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${day}, ${wallTime(value)}`;
}

export function whole(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

const trim = (text: string) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);

export function ms(value: number): string {
  return value >= 100 ? `${whole(value)} ms` : `${trim(value.toFixed(value >= 10 ? 1 : 2))} ms`;
}

export function percent(ratio: number): string {
  const value = ratio * 100;
  if (value === 0) return '0%';
  if (value > 0 && value < 0.005) return '<0.01%';
  return `${trim(value.toFixed(value >= 10 ? 1 : 2))}%`;
}

/** Target readings are shown as the target reported them. */
export function reading(value: number): string {
  return Math.abs(value) >= 100
    ? whole(value)
    : value.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: value % 1 ? 1 : 0 });
}

export function shortId(id: string): string {
  return id.slice(0, 4);
}

/** A rough length for prose: "30 s", "4 min". */
export function span(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}
