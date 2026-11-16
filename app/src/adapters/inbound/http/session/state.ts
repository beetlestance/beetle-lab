import type { StoredBrowserSession } from '../../../../ports/local-session.js';
import { captureStoredSession } from '../../../../domain/local-session/index.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { BrowserSession } from '@beetle/contracts/api';
import { ApiFault } from '../api-errors.js';

const BOOTSTRAP_MS = 15 * 60_000;
const SESSION_MS = 8 * 60 * 60_000;
export interface SessionClocks {
  readonly monotonicNow: () => number;
  readonly wallNow: () => number;
}
interface Instant { readonly monotonic: number; readonly wall: number }
interface Session { readonly issuedAt: string; readonly secret: string; readonly view: BrowserSession; readonly deadline: number }
export interface Grant { readonly cookie: string; readonly view: BrowserSession }

function secret(): string { return randomBytes(32).toString('base64url'); }
export function equalSecret(actual: string | undefined, expected: string): boolean {
  return typeof actual === 'string' && /^[A-Za-z0-9_-]{43}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, 'ascii'), Buffer.from(expected, 'ascii'));
}
function validWall(wall: number): boolean {
  if (!Number.isFinite(wall)) return false;
  const expiry = new Date(wall + SESSION_MS);
  return Number.isFinite(expiry.getTime()) && expiry.getUTCFullYear() >= 0 && expiry.getUTCFullYear() <= 9999;
}

/** One instance owns one bootstrap and one absolute-lifetime session. No IO or timers. */
export class SessionAuthority {
  readonly bootstrapToken = secret();
  private bootstrap: string | undefined = this.bootstrapToken;
  private session: Session | undefined;
  private closed = false;
  private readingClock = false;
  private lastMonotonic = -1;
  private readonly bootstrapDeadline: number;
  private windowStart: number;
  private attempts = 0;
  private readonly clocks: SessionClocks;

  constructor(clocks: SessionClocks) {
    this.clocks = Object.freeze({ monotonicNow: clocks.monotonicNow, wallNow: clocks.wallNow });
    if (typeof this.clocks.monotonicNow !== 'function' || typeof this.clocks.wallNow !== 'function') {
      throw new TypeError('Session clock functions required');
    }
    const now = this.now();
    this.bootstrapDeadline = now.monotonic + BOOTSTRAP_MS;
    this.windowStart = now.monotonic;
  }

  private now(): Instant {
    if (this.closed || this.readingClock) { this.close(); throw new ApiFault('unpaired'); }
    this.readingClock = true;
    try {
      const monotonic = this.clocks.monotonicNow(); const wall = this.clocks.wallNow();
      if (this.closed || !Number.isFinite(monotonic) || monotonic < this.lastMonotonic ||
        monotonic < 0 || monotonic > Number.MAX_SAFE_INTEGER - SESSION_MS || !validWall(wall)) {
        this.close(); throw new ApiFault('unpaired');
      }
      this.lastMonotonic = monotonic;
      return { monotonic, wall };
    } catch { this.close(); throw new ApiFault('unpaired'); }
    finally { this.readingClock = false; }
  }

  admitPair(): void {
    const now = this.now();
    if (now.monotonic - this.windowStart >= 60_000) { this.windowStart = now.monotonic; this.attempts = 0; }
    if (this.attempts >= 5) throw new ApiFault('rate_limited');
    this.attempts += 1;
  }

  pair(token: string): Grant {
    const now = this.now();
    if (!this.bootstrap || now.monotonic >= this.bootstrapDeadline || !equalSecret(token, this.bootstrap)) {
      throw new ApiFault('unpaired');
    }
    const session: Session = { issuedAt: new Date(now.wall).toISOString(), secret: secret(), deadline: now.monotonic + SESSION_MS,
      view: { scope: 'local-admin', expiresAt: new Date(now.wall + SESSION_MS).toISOString(), csrfToken: secret() } };
    this.bootstrap = undefined;
    this.session = session;
    return { cookie: session.secret, view: { ...session.view } };
  }

  /** Trusted private persistence, restored without extending the absolute lifetime. */
  restore(input: StoredBrowserSession | null): void {
    const stored = captureStoredSession(input); const now = this.now(); const previous = this.session; this.session = undefined;
    if (!stored) return;
    const issued = Date.parse(stored.issuedAt); const expires = Date.parse(stored.expiresAt);
    if (issued > now.wall) {this.close(); throw new TypeError('Local session clock fenced');}
    if (expires <= now.wall) return;
    const restoredDeadline = now.monotonic + expires - now.wall;
    const deadline = previous?.secret === stored.cookie ? Math.min(previous.deadline, restoredDeadline) : restoredDeadline;
    this.session = {issuedAt: stored.issuedAt, secret: stored.cookie, deadline,
      view: {scope: 'local-admin', expiresAt: stored.expiresAt, csrfToken: stored.csrfToken}};
  }
  /** Local-profile owner must confirm persistence before returning this grant. */
  localGrant(): Grant {
    const now = this.now();
    if (!this.session || now.monotonic >= this.session.deadline) this.session = {
      issuedAt: new Date(now.wall).toISOString(), secret: secret(), deadline: now.monotonic + SESSION_MS,
      view: {scope: 'local-admin', expiresAt: new Date(now.wall + SESSION_MS).toISOString(), csrfToken: secret()}};
    return {cookie: this.session.secret, view: {...this.session.view}};
  }
  snapshot(): StoredBrowserSession | null {
    const session = this.session;
    return session ? {cookie: session.secret, csrfToken: session.view.csrfToken, issuedAt: session.issuedAt, expiresAt: session.view.expiresAt} : null;
  }
  authenticate(cookie: string | undefined): BrowserSession {
    const now = this.now();
    if (this.session && now.monotonic >= this.session.deadline) this.session = undefined;
    if (!this.session || !equalSecret(cookie, this.session.secret)) throw new ApiFault('unpaired');
    return { ...this.session.view };
  }

  logout(cookie: string | undefined): void { this.authenticate(cookie); this.session = undefined; }
  close(): void { this.closed = true; this.bootstrap = undefined; this.session = undefined; }
}
