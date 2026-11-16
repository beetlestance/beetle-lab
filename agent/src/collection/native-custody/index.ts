import { isAbsolute, normalize } from 'node:path';
export type NativeCustodyKind = 'collection' | 'range' | 'cleanup';
export class NativeCustodyError extends Error {
  constructor(readonly reason: 'busy' | 'invalid_scope' | 'released') { super(`Native custody ${reason}`); }
}
interface Entry { readonly kind: NativeCustodyKind; owner?: object; directory?: string }
export interface NativeCustodyLease {
  /** Bind the actual strong lifetime before capture callbacks or native factories. */
  own(owner: object): void;
  /** Captured canonical spelling; not native identity or filesystem permission. */
  bind(directory: string): void;
  /** Only the original lifetime's successful actual-close path may call this. */
  release(): void;
}
function validDirectory(directory: string): boolean {
  return typeof directory === 'string' && !directory.endsWith('/') && Buffer.byteLength(directory) <= 4096
    && !directory.includes('\0') && isAbsolute(directory) && normalize(directory) === directory;
}
function overlaps(a: string, b: string): boolean { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
/** Shared output-native admission. Control readers/producers still require the C2 barrier. */
export class NativeCustody {
  private readonly entries = new Set<Entry>();
  reserve(kind: NativeCustodyKind): NativeCustodyLease | undefined {
    if (!['collection', 'range', 'cleanup'].includes(kind)) throw new NativeCustodyError('invalid_scope');
    if (this.entries.size >= 4 || [...this.entries].filter(entry => entry.kind === kind).length >= 2) return undefined;
    const entry: Entry = { kind }; this.entries.add(entry);
    const current = () => { if (!this.entries.has(entry)) throw new NativeCustodyError('released'); };
    return Object.freeze({
      own: (owner: object) => { current(); if (!owner || typeof owner !== 'object' || entry.owner) throw new NativeCustodyError('invalid_scope'); entry.owner = owner; },
      bind: (directory: string) => { current(); this.bind(entry, directory); },
      release: () => { this.entries.delete(entry); },
    });
  }
  private bind(entry: Entry, directory: string): void {
    if (!entry.owner || !validDirectory(directory) || entry.directory !== undefined) throw new NativeCustodyError('invalid_scope');
    for (const other of this.entries) {
      if (entry === other || entry.kind !== 'cleanup' && other.kind !== 'cleanup') continue;
      // An original still capturing its scope cannot be treated as disjoint.
      if (other.directory === undefined || overlaps(directory, other.directory)) throw new NativeCustodyError('busy');
    }
    entry.directory = directory;
  }
  status(): Readonly<{ retained: number; collection: number; range: number; cleanup: number }> {
    const rows = [...this.entries];
    return Object.freeze({ retained: rows.length, collection: rows.filter(row => row.kind === 'collection').length,
      range: rows.filter(row => row.kind === 'range').length, cleanup: rows.filter(row => row.kind === 'cleanup').length });
  }
}
export const nativeCustody = new NativeCustody();
