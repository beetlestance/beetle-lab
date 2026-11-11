import { LiveMetricStale } from './read.js';
import type { LiveFrame } from './read.js';
interface Position {epoch: string; subset: string; revision: number; source: number; end: number;
  captured: number; published: number; coalesced: number; fingerprint: string; expires: number; wall: number; mono: number}
/** Display continuity only. Trusted producer approval is enforced by the agent. */
export class LivePosition {
  private previous: Position | undefined;
  accept(value: LiveFrame, now: number): LiveFrame {
    const f = value.frame; const old = this.previous;
    let expires = value.expiresAtMono;
    if (old) {
      if (old.epoch !== f.producerEpoch || old.subset !== f.subsetDigest || value.receivedWall < old.wall
        || value.receivedMono < old.mono || f.publishedSequence < old.revision) throw new Error('Live metric continuity changed');
      expires = this.sequence(value, old);
    }
    if (!Number.isFinite(now) || now < value.receivedMono) throw new Error('Live metric clock invalid');
    if (now >= expires) throw new LiveMetricStale();
    this.previous = {epoch: f.producerEpoch, subset: f.subsetDigest, revision: f.publishedSequence,
      source: f.sourceSequence, end: f.endTimeMs, captured: f.capturedAtMs, published: f.publishedAtMs,
      coalesced: f.coalescedWindows, fingerprint: value.fingerprint, expires, wall: value.receivedWall, mono: value.receivedMono};
    return {...value, expiresAtMono: expires};
  }
  private sequence(value: LiveFrame, old: Position): number {
    const f = value.frame;
    if (f.publishedSequence === old.revision) {
      if (value.fingerprint !== old.fingerprint) throw new Error('Repeated live frame changed');
      return Math.min(old.expires, value.expiresAtMono);
    }
    if (f.sourceSequence <= old.source || f.startTimeMs < old.end || f.capturedAtMs < old.captured
      || f.publishedAtMs < old.published || f.coalescedWindows < old.coalesced) throw new Error('Live metrics regressed');
    return value.expiresAtMono;
  }
}
