import type { DatabaseSync } from 'node:sqlite';
import type { DiskRetention } from '../../admission/index.js';
import { captureDiskRetention } from '../../admission/index.js';
import { Failure } from '../sql.js';

export function diskRetention(db: DatabaseSync): DiskRetention {
  try {
    const row = db.prepare(`SELECT held_count AS heldCount, retained_output_bytes AS outputBytes,
      retained_staging_bytes AS stagingBytes,r.charged_bytes AS replayBytes FROM disk_retention_stats h
      JOIN agent_replay_storage r ON r.id=h.id WHERE h.id=1`).get();
    return captureDiskRetention(row);
  } catch { throw new Failure('unavailable'); }
}
