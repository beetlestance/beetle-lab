import { encodeCanonicalJson } from '@beetle/contracts';
import type { BrowserSession } from '@beetle/contracts/api';
import type { LocalSessionRecord, LocalSessionStore, StoredBrowserSession } from '../../../../ports/local-session.js';
import { captureSessionRecord } from '../../../../domain/local-session/index.js';
import { ApiFault } from '../api-errors.js';
import type { SessionAuthority } from './state.js';
import type { Grant } from './state.js';
interface Original {readonly expectedVersion: number; readonly session: StoredBrowserSession | null}
/** One original credential write; unknown outcomes retain its exact CAS/value. */
export class AutomaticSessions {
  private record: LocalSessionRecord;
  private original: Original | undefined;
  private writing = false;
  private closed = false;
  constructor(private readonly authority: SessionAuthority, private readonly store: LocalSessionStore, initial: LocalSessionRecord) {
    this.record = captureSessionRecord(initial); authority.restore(this.record.session);
  }
  authenticate(cookie: string | undefined, logoutReplay = false): BrowserSession {
    this.check(); if (this.original && !(logoutReplay && this.original.session === null)) throw new ApiFault('storage_unavailable');
    return this.authority.authenticate(cookie);
  }
  async grant(): Promise<Grant> {
    this.check(); if (this.writing) throw new ApiFault('rate_limited');
    if (this.original) await this.persist();
    const grant = this.authority.localGrant(); const session = this.authority.snapshot();
    if (encodeCanonicalJson(session, 1024) !== encodeCanonicalJson(this.record.session, 1024)) {
      this.original = {expectedVersion: this.record.version, session}; await this.persist();
    }
    this.check(); this.authority.authenticate(grant.cookie); return grant;
  }
  async logout(cookie: string | undefined): Promise<void> {
    this.check(); if (this.writing) throw new ApiFault('rate_limited');
    // An unknown logout retries its exact original before accepting another write.
    if (this.original) {
      if (this.original.session !== null) throw new ApiFault('storage_unavailable');
      this.authority.authenticate(cookie); await this.persist(); return;
    }
    this.authority.authenticate(cookie);
    this.original = {expectedVersion: this.record.version, session: null}; await this.persist();
  }
  confirmLogout(): void {
    this.check();
    if (this.original || this.writing || this.record.session !== null) throw new ApiFault('storage_unavailable');
  }
  private async persist(): Promise<void> {
    const original = this.original; if (!original) return;
    this.writing = true;
    try {
      const reply = captureSessionRecord(await this.store.save(original.expectedVersion, original.session));
      if (reply.version !== original.expectedVersion + 1 || encodeCanonicalJson(reply.session, 1024) !== encodeCanonicalJson(original.session, 1024)) throw new ApiFault('storage_unavailable');
      this.record = reply; this.original = undefined; this.check();
      this.authority.restore(reply.session);
    } finally {this.writing = false;}
  }
  private check(): void {if (this.closed) throw new ApiFault('unpaired');}
  close(): void {this.closed = true; this.authority.close();}
}
