import { encodeCanonicalJson } from '@beetle/contracts';
import type { RuntimeObservation } from '../../../ports/runtime.js';
import { CapacityError } from './disk.js';

/** One source fingerprint/result and scalar fences; polling cannot grant a lease. */
export class CapacityLease {
  private highWall = -1;
  private highSource = -1;
  private revokedThrough = -1;
  private fingerprint: string | undefined;
  private result: RuntimeObservation | null = null;
  private revoked = false;
  constructor(private readonly wall: () => number) {}
  time(): number {
    const now = this.wall();
    if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 || now < this.highWall) {
      this.revoke(); throw new CapacityError();
    }
    this.highWall = now;
    if (this.result !== null && now >= this.result.expiresAtMs) this.revoke();
    return now;
  }
  revoke(source = -1): null {
    this.result = null; this.fingerprint = undefined;
    this.highSource = Math.max(this.highSource, source);
    this.revokedThrough = Math.max(this.revokedThrough, this.highSource, this.revoked ? -1 : this.highWall);
    this.revoked = true;
    return null;
  }
  accept(source: number, fingerprint: string, candidate: RuntimeObservation): RuntimeObservation {
    const now = this.time();
    if (source < this.highSource || source <= this.revokedThrough || now >= candidate.expiresAtMs) {
      this.revoke(); throw new CapacityError();
    }
    if (source === this.highSource) return this.replay(fingerprint, candidate);
    this.highSource = source; this.fingerprint = fingerprint;
    this.result = candidate; this.revoked = false;
    return structuredClone(candidate);
  }
  private replay(fingerprint: string, candidate: RuntimeObservation): RuntimeObservation {
    const result = this.result;
    if (result === null || this.fingerprint !== fingerprint ||
      encodeCanonicalJson(result.ceilings, 8192) !== encodeCanonicalJson(candidate.ceilings, 8192)) {
      this.revoke(); throw new CapacityError();
    }
    return structuredClone(result);
  }
}
