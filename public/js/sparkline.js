// Tiny inline-SVG sparkline. Returns markup for an <svg class="spark">.
// values: number[]; gaps render as zero.
export function sparkline(values, opts = {}) {
  const W = opts.width || 80;
  const H = opts.height || 22;
  const pad = 1;
  if (!values || values.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none"></svg>`;
  }
  const max = Math.max(1, ...values);
  const n = values.length;
  const step = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = H - pad - (v / max) * (H - pad * 2);
    return [x, y];
  });
  const linePath =
    "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const lastX = pts[pts.length - 1][0];
  const areaPath = `${linePath} L${lastX.toFixed(1)},${H} L${pad},${H} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none">
    <path class="area" d="${areaPath}"/>
    <path class="line" d="${linePath}"/>
  </svg>`;
}

// Aggregate raw timestamps into N hour-buckets ending at now, returning counts.
export function bucketByHour(timestamps, hours = 24) {
  const now = Date.now();
  const slot = (now - hours * 3600 * 1000) / hours;
  const buckets = new Array(hours).fill(0);
  for (const t of timestamps) {
    if (!t) continue;
    const i = Math.min(hours - 1, Math.max(0, Math.floor((t - (now - hours * 3600 * 1000)) / 3600000)));
    buckets[i] += 1;
  }
  void slot;
  return buckets;
}
