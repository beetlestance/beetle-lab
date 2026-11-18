import { captureMetricWindow, metricSeriesIdentity } from '@beetle/contracts/metrics';
import type { MetricWindow } from '@beetle/contracts/metrics';
import { archiveHeader } from './archive.js';
import type { ReadyArchive } from './archive.js';
import type { ArchiveIO } from './io.js';
import { fail, fields } from './values.js';
export const HISTORY_SCAN_LIMITS = Object.freeze({ windows: 3600, dataBytes: 33554432 });
function decode(value: unknown): MetricWindow {
  try {
    return captureMetricWindow(value);
  } catch {
    return fail();
  }
}
/** One original full-SHA pass; no consumer can retain unbounded source frames. */
export async function scanArchiveWindows(
  io: ArchiveIO,
  archive: ReadyArchive,
  consume: (window: MetricWindow, sequence: number) => void,
): Promise<void> {
  if (
    archive.numeric.windows > HISTORY_SCAN_LIMITS.windows ||
    archive.data.artifact.bytes > HISTORY_SCAN_LIMITS.dataBytes
  )
    return fail();
  const known = new Set(archive.numeric.totals.map(metricSeriesIdentity));
  let lines = 0;
  let sequence = 0;
  let through = 0;
  let ended = false;
  await io.lines(
    archive.data,
    { start: 0, end: archive.data.artifact.bytes },
    1048576,
    (value) => {
      if (lines++ === 0) return archiveHeader(value, 'beetle-k6-metric-windows', archive);
      if (ended) return fail();
      if ((value as { kind?: unknown })?.kind === 'end') {
        if (fields(value, ['kind', 'windows']).windows !== archive.numeric.windows) return fail();
        ended = true;
        return;
      }
      const row = fields(value, ['kind', 'sequence', 'window']);
      if (row.kind !== 'window' || row.sequence !== sequence + 1 || sequence >= archive.numeric.windows) return fail();
      const window = checkedWindow(row.window, known, through);
      through = window.endTimeMs;
      consume(window, ++sequence);
    },
    true,
  );
  if (!ended || sequence !== archive.numeric.windows) return fail();
}

function checkedWindow(value: unknown, known: ReadonlySet<string>, through: number): MetricWindow {
  const window = decode(value);
  if (window.startTimeMs < through || window.series.some((item) => !known.has(metricSeriesIdentity(item))))
    return fail();
  return window;
}
