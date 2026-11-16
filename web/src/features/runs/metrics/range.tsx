import { useState, type FormEvent } from 'react';
import type { SourceRange } from './useSamples.js';

const MAX_TIME = 8640000000000000;
const INVALID = 'Enter valid UTC source times with From earlier than To.';

export function SourceRangeControls({applied, onApply, onReset}: {
  applied: SourceRange | undefined;
  onApply: (range: SourceRange) => void;
  onReset: () => void;
}) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [error, setError] = useState('');
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fromTimeMs = parseUtc(from); const toTimeMs = parseUtc(to);
    if (fromTimeMs === null || toTimeMs === null || fromTimeMs >= toTimeMs) {setError(INVALID); return;}
    setError(''); onApply({fromTimeMs, toTimeMs});
  }
  function reset() {setFrom(''); setTo(''); setError(''); onReset();}
  return <section aria-label="Source time range">
    <form onSubmit={apply} noValidate>
      <label>From source time (UTC)<input aria-label="From source time (UTC)" type="datetime-local" step="0.001" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>To source time (UTC)<input aria-label="To source time (UTC)" type="datetime-local" step="0.001" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button type="submit">Apply range</button><button type="button" onClick={reset}>Reset range</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {applied && <p>Applied source range: <time dateTime={new Date(applied.fromTimeMs).toISOString()}>{new Date(applied.fromTimeMs).toISOString()}</time> – <time dateTime={new Date(applied.toTimeMs).toISOString()}>{new Date(applied.toTimeMs).toISOString()}</time></p>}
  </section>;
}

function parseUtc(value: string): number | null {
  const parts = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second, fraction] = parts.slice(1);
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second ?? 0), Number((fraction ?? '').padEnd(3, '0')));
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIME) return null;
  const actual = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
  const expected = [year, month, day, hour, minute, second ?? '0'].map(Number);
  if (!actual.every((part, index) => part === expected[index])) return null;
  return timestamp;
}
