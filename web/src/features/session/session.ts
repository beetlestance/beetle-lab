import { createApiClient, createInputTransferClient } from '@beetle/contracts/api';
import type { ApiClient, ApiClientResult, ApiClientFailure, BrowserSession, InputTransferClient } from '@beetle/contracts/api';
import { unknownOutcome } from '../../app/errors.js';
import { SessionTransferOwner } from './transfer-owner.js';

export interface SessionOptions { baseUrl: string; fetch?: typeof fetch; autoOpen?: boolean }
export type SessionState =
  | { kind: 'checking' | 'pairing' | 'logging-out'; message: string }
  | { kind: 'unpaired' | 'unavailable'; message: string }
  | { kind: 'paired'; session: BrowserSession; client: ApiClient; transfers: InputTransferClient; generation: number };
interface Epoch { generation: number; abort: AbortController }
const restart = 'Restart the local service to get a fresh startup token if the previous token was used or expired.';
const lostPair = 'The pairing outcome is unknown. The one-time token may have been consumed.';
const lostWrite = 'Your session ended. An unacknowledged change may have committed; its outcome is unknown. Check the current data after pairing before making another change.';

/** One session epoch owns all resource requests; retiring it also discards App state. */
export class BrowserSessionGate {
  private state: SessionState = { kind: 'checking', message: 'Checking local session…' };
  private epoch: Epoch = { generation: 0, abort: new AbortController() };
  private listeners = new Set<() => void>();
  private active = false;
  private accessMode: 'automatic' | 'paired' = 'paired';
  private readonly transfers = new SessionTransferOwner(createInputTransferClient);
  constructor(private readonly options: SessionOptions) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  start() { this.active = true; this.check(); }
  stop() {
    this.active = false;
    this.epoch.abort.abort();
    this.state = { kind: 'checking', message: 'Checking local session…' };
  }
  private current(epoch: Epoch) { return this.active && this.epoch === epoch && !epoch.abort.signal.aborted; }
  private publish(state: SessionState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  private begin(state: SessionState): Epoch {
    const previous = this.epoch;
    const next = { generation: previous.generation + 1, abort: new AbortController() };
    // Cleanup and subscribers may reenter: reserve and return this exact epoch.
    this.epoch = next;
    previous.abort.abort();
    if (this.current(next)) this.publish(state);
    return next;
  }
  private client(epoch: Epoch, headers: Readonly<Record<string, string>> = {}, observe = false): ApiClient {
    const fetcher = this.options.fetch ?? fetch;
    const scopedFetch: typeof fetch = async (input, init) => {
      const signal = init?.signal ? AbortSignal.any([init.signal, epoch.abort.signal]) : epoch.abort.signal;
      signal.throwIfAborted();
      const reply = await fetcher(input, { ...init, signal, credentials: 'same-origin' });
      if (observe && reply.status === 401 && this.current(epoch)) {
        this.ended();
      }
      if (!this.current(epoch)) {
        await reply.body?.cancel();
        throw new Error('Session retired');
      }
      return reply;
    };
    return createApiClient({ ...this.options, fetch: scopedFetch, headers });
  }
  private transferFetch(epoch: Epoch): typeof fetch {
    const fetcher = this.options.fetch ?? fetch;
    return async (input, init) => {
      const reply = await fetcher(input, init);
      if (reply.status === 401 && this.current(epoch)) this.ended();
      // The byte client owns late response body cancellation and its original promise.
      return reply;
    };
  }
  private ended() {
    this.begin({kind: this.accessMode === 'automatic' ? 'unavailable' : 'unpaired',
      message: this.accessMode === 'automatic' ? `${lostWrite} Check session status to reconnect.` : `${lostWrite} ${restart}`});
  }
  private async accept(epoch: Epoch, session: BrowserSession) {
    if (!this.current(epoch)) return;
    this.accessMode = session.accessMode ?? 'paired';
    try {
      const transfers = await this.transfers.open({ baseUrl: this.options.baseUrl,
        headers: { 'X-Beetle-CSRF': session.csrfToken }, fetch: this.transferFetch(epoch) }, epoch.abort.signal);
      if (!transfers || !this.current(epoch)) return;
      const client = this.client(epoch, { 'X-Beetle-CSRF': session.csrfToken }, true);
      if (!this.current(epoch)) return;
      this.publish({ kind: 'paired', session, client, transfers, generation: epoch.generation });
    } catch {
      if (this.current(epoch)) this.publish({ kind: 'unavailable',
        message: 'The session could not open its transfers. Reload this page before continuing. Unacknowledged changes may have committed.' });
    }
  }
  check = () => {
    const epoch = this.begin({ kind: 'checking', message: 'Checking local session…' });
    void this.readSession(epoch);
  };
  private async readSession(epoch: Epoch, context = '', automatic = this.options.autoOpen !== false) {
    if (!this.current(epoch)) return;
    const result = await this.client(epoch).getBrowserSession({ signal: epoch.abort.signal });
    if (!this.current(epoch)) return;
    if (result.ok) { await this.accept(epoch, result.value); return; }
    const unpaired = result.error.status === 401;
    if (automatic && localExchangeNeeded(result.error)) {await this.openLocal(epoch); return;}
    this.publish({ kind: unpaired ? 'unpaired' : 'unavailable', message: unpaired
      ? `${context} Pair this browser with the token printed at local startup. ${restart}`
      : `${context} Session status could not be verified. Check that the local service is running, then check again.` });
  }
  private async openLocal(epoch: Epoch) {
    const result = await this.client(epoch, {'X-Beetle-Local': '1'}).openLocalBrowserSession({body: {}, signal: epoch.abort.signal});
    if (!this.current(epoch)) return;
    if (result.ok) {await this.accept(epoch, result.value); return;}
    if (result.error.status === 401) {
      this.publish({kind: 'unpaired', message: `Pair this browser with the token printed at local startup. ${restart}`}); return;
    }
    if (unknownOutcome(result.error)) {await this.recoverLocal(epoch); return;}
    this.publish({kind: 'unavailable', message: 'Local access could not open. Check that the service is running, then check session status.'});
  }
  private async recoverLocal(epoch: Epoch) {
    const result = await this.client(epoch).getBrowserSession({signal: epoch.abort.signal});
    if (!this.current(epoch)) return;
    if (result.ok) {await this.accept(epoch, result.value); return;}
    this.publish({kind: 'unavailable', message: 'Local access could not be confirmed. Check session status to reconnect.'});
  }
  pair = (bootstrapToken: string) => {
    if (this.state.kind !== 'unpaired') return;
    const epoch = this.begin({ kind: 'pairing', message: 'Pairing this browser…' });
    if (!this.current(epoch)) return;
    const pending = this.client(epoch, { 'X-Beetle-Pair': '1' }).pairBrowserSession({
      body: { bootstrapToken }, signal: epoch.abort.signal,
    });
    void this.finishPair(epoch, pending);
  };
  private async finishPair(epoch: Epoch, pending: Promise<ApiClientResult<BrowserSession>>) {
    const result = await pending;
    if (!this.current(epoch)) return;
    if (result.ok) { await this.accept(epoch, result.value); return; }
    if (unknownOutcome(result.error)) {
      this.publish({ kind: 'checking', message: `${lostPair} Checking session status…` });
      await this.readSession(epoch, lostPair, false);
      return;
    }
    this.publish({ kind: 'unpaired', message: `Pairing was not accepted. Check the startup token and service status. ${restart}` });
  }
  logout = () => {
    if (this.state.kind !== 'paired') return;
    const csrfToken = this.state.session.csrfToken;
    const epoch = this.begin({ kind: 'logging-out', message: 'Signing out… Unacknowledged changes may have committed; check their outcome before repeating them.' });
    if (!this.current(epoch)) return;
    const pending = this.client(epoch, { 'X-Beetle-CSRF': csrfToken }).logoutBrowserSession({
      body: {}, signal: epoch.abort.signal,
    });
    void this.finishLogout(epoch, pending);
  };
  private async finishLogout(epoch: Epoch, pending: Promise<ApiClientResult<unknown>>) {
    const result = await pending;
    if (!this.current(epoch)) return;
    if (result.ok || result.error.status === 401) {
      this.publish({ kind: this.accessMode === 'automatic' ? 'unavailable' : 'unpaired', message: `This browser is signed out. Unacknowledged changes may have committed; their outcome is unknown. ${this.accessMode === 'automatic' ? 'Check session status to reopen Beetle Lab.' : restart}` });
      return;
    }
    this.publish({ kind: 'unavailable', message: `Sign-out could not be confirmed. The session may still be active. Check session status before continuing. Unacknowledged changes may have committed; their outcome is unknown.` });
  }
}

function localExchangeNeeded(error: ApiClientFailure): boolean {
  return error.status === 401 || error.protocol?.code === 'storage_unavailable';
}
