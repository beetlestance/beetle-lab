import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeK6HistoryCheckpoint, K6_HISTORY_CHECKPOINT_NAMES } from '@beetle/contracts/k6-live';
import type { K6LiveApproval } from '@beetle/contracts/k6-live';
import type { LiveMetricArchivePrefix } from '@beetle/contracts/api';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const uid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

export async function writeCheckpoint(path: string, approval: K6LiveApproval): Promise<void> {
  const scope = approval.scope;
  const dataId = uid(12);
  const header = (format: string) => JSON.stringify({ format, version: 1, scope, dataArtifactId: dataId }) + '\n';
  const dataHeader = header('beetle-k6-metric-windows');
  const window = { startTimeMs: 0, endTimeMs: 1000, series: [] };
  const row = JSON.stringify({ kind: 'window', sequence: 1, window }) + '\n';
  const data = dataHeader + row;
  const index =
    header('beetle-k6-metric-index') +
    JSON.stringify({
      sequence: 1,
      startTimeMs: 0,
      endTimeMs: 1000,
      offset: Buffer.byteLength(dataHeader),
      length: Buffer.byteLength(row),
    }) +
    '\n';
  const prefix: LiveMetricArchivePrefix = {
    scope,
    windows: 1,
    endTimeMs: 1000,
    data: {
      artifactId: dataId,
      relativePath: 'metric-windows.ndjson',
      bytes: Buffer.byteLength(data),
      sha256: hash(data),
    },
    index: {
      artifactId: uid(13),
      relativePath: 'metric-index.ndjson',
      bytes: Buffer.byteLength(index),
      sha256: hash(index),
    },
  };
  await writeFile(join(path, prefix.data.relativePath), data, { mode: 0o600 });
  await writeFile(join(path, prefix.index.relativePath), index, { mode: 0o600 });
  await writeFile(join(path, K6_HISTORY_CHECKPOINT_NAMES[0]), encodeK6HistoryCheckpoint(prefix, approval, hash), {
    mode: 0o600,
  });
}
