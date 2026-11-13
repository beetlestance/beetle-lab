import type { Scope } from '../admission/index.js';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureRetirementIntent } from '../retirement-values/index.js';
import type { RetirementIntent, JournalRetirements } from '../retirement-values/index.js';
import { ProducerGateError } from './types.js';
import type { GateOptions, ProducerLease, ProducerFence } from './types.js';
import { makeLease } from './lease.js';
import { captureKey, identity } from './entry.js';
import type { GateEntry } from './entry.js';
export { ProducerGateError } from './types.js';
export type { ProducerLease, ProducerFence, GateOptions } from './types.js';
const owners = new WeakMap<JournalRetirements, ProducerGate>();
/** Strong owners survive loss of the service handle while original cleanup is unresolved. */
const activeOwners = new Set<ProducerGate>();
export class ProducerGate {
  private readonly entries = new Map<string, GateEntry>();
  private leases = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly journal: JournalRetirements;
  readonly namespaceIdentity: string;
  constructor(options: GateOptions) {
    if (!/^[a-f0-9]{64}$/.test(options.namespaceIdentity)) throw new ProducerGateError('invalid_input');
    if (owners.has(options.journal)) throw new ProducerGateError('owner');
    this.journal = options.journal; this.namespaceIdentity = options.namespaceIdentity; owners.set(this.journal, this);
  }
  assertOwner(journal: JournalRetirements): void { if (journal !== this.journal) throw new ProducerGateError('owner'); }
  status() { return Object.freeze({ entries: this.entries.size, leases: this.leases }); }
  private entry(key: Readonly<Scope>): GateEntry {
    const id = identity(key); const existing = this.entries.get(id); if (existing) return existing;
    if (this.entries.size >= 64) throw new ProducerGateError('capacity');
    const entry: GateEntry = { key, leases: new Set(), fenced: false, durable: false, barrier: false };
    this.entries.set(id, entry); activeOwners.add(this); return entry;
  }
  private evict(entry: GateEntry): void {
    if (entry.leases.size || entry.barrier || (entry.fenced && !entry.durable)) return;
    this.entries.delete(identity(entry.key)); if (!this.entries.size) activeOwners.delete(this);
  }
  /** Synchronous reservation precedes the first foreign call, including Journal IPC. */
  acquire(input: Scope): ProducerLease {
    if (this.closed) throw new ProducerGateError('closed');
    if (this.leases >= 64) throw new ProducerGateError('capacity');
    const entry = this.entry(captureKey(input));
    if ([...entry.leases].some(lease => lease.poisoned)) throw new ProducerGateError('cleanup');
    if (entry.fenced) throw new ProducerGateError('retired');
    this.leases++;
    return makeLease(entry, this.journal, () => { this.leases--; this.evict(entry); }, () => this.closed);
  }
  /** Reserve/fence before durable begin; the future coordinator owns carrier settlement. */
  reserve(input: Scope): ProducerFence {
    if (this.closed) throw new ProducerGateError('closed');
    const entry = this.entry(captureKey(input));
    if (entry.barrier) throw new ProducerGateError('capacity');
    entry.barrier = true; let released = false; let issued = false;
    const check = () => { if (released || this.entries.get(identity(entry.key)) !== entry) throw new ProducerGateError('cleanup'); };
    return Object.freeze({ key: entry.key,
      fence: () => { check(); issued = true; entry.fenced = true; },
      confirm: async (input: RetirementIntent) => {
        check(); if (!issued) throw new ProducerGateError('cleanup');
        const intent = captureRetirementIntent(input); const request = intent.request;
        const key = { organizationId: request.organizationId, workspaceId: request.workspaceId, attemptId: request.attemptId, generation: request.generation };
        if (intent.namespaceIdentity !== this.namespaceIdentity || identity(key) !== identity(entry.key)) throw new ProducerGateError('owner');
        const observed = await this.journal.read(entry.key); check();
        if (encodeCanonicalJson(observed, 4096) !== encodeCanonicalJson(intent, 4096)) throw new ProducerGateError('owner');
        entry.durable = true;
      },
      drain: async () => { check(); if (!issued) throw new ProducerGateError('cleanup'); await Promise.all([...entry.leases].map(lease => lease.done)); },
      release: () => {
        check(); if ((issued && !entry.durable) || (issued && entry.leases.size)) throw new ProducerGateError('cleanup');
        released = true; entry.barrier = false; this.evict(entry);
      },
    });
  }
  /** Shutdown retains all original leases; failed/unknown custody cannot release the runtime owner. */
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true;
    this.closing = Promise.resolve().then(async () => {
      const entries = [...this.entries.values()];
      await Promise.all(entries.flatMap(entry => [...entry.leases].map(lease => lease.done)));
      if (entries.some(entry => entry.barrier || (entry.fenced && !entry.durable))) throw new ProducerGateError('cleanup');
    });
    return this.closing;
  }

}
