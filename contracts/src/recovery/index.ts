import { encodeCanonicalJson } from '../json.js';
import { validate } from '../validate.js';
import type { RecoveryRecord as WireRecord } from '../generated/types.js';
type Immutable<T> = T extends object ? {readonly [K in keyof T]: Immutable<T[K]>} : T;
export type RecoveryRecord = Immutable<WireRecord>;
export type RecoveryHeader = Extract<RecoveryRecord, {kind: 'header'}>;
export type RecoveryEntry = Extract<RecoveryRecord, {kind: 'file' | 'directory'}>;
export type RecoveryFile = Extract<RecoveryRecord, {kind: 'file'}>;
export const recoveryCaps = Object.freeze({lineBytes: 8192, manifestBytes: 33554432, entries: 100000, pathBytes: 8388608, depth: 32});
export class RecoveryFormatError extends Error {constructor() {super('Recovery format rejected');}}
export function recoveryPath(value: string): boolean {
  const parts = value.split('/');
  return value.length <= 1024 && parts.length <= recoveryCaps.depth && parts.every(part => part !== '.' && part !== '..' && /^[a-z0-9._-]+$/.test(part));
}
function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const member of Object.values(value)) freeze(member);
  Object.freeze(value);
}
export function captureRecoveryRecord(input: unknown): RecoveryRecord {
  try {
    const value: unknown = JSON.parse(encodeCanonicalJson(input, recoveryCaps.lineBytes - 1));
    const checked = validate('RecoveryRecord', value); if (!checked.ok) throw new RecoveryFormatError();
    const record = checked.value;
    const paths = record.kind === 'header' ? Object.values(record.roles).filter((path): path is string => path !== null)
      : record.kind === 'file' || record.kind === 'directory' ? [record.path] : [];
    if (!paths.every(recoveryPath)) throw new RecoveryFormatError();
    freeze(record); return record;
  } catch {throw new RecoveryFormatError();}
}
export function encodeRecoveryLine(input: unknown): Uint8Array {
  return new TextEncoder().encode(encodeCanonicalJson(captureRecoveryRecord(input), recoveryCaps.lineBytes - 1) + '\n');
}
export function decodeRecoveryLine(bytes: Uint8Array): RecoveryRecord {
  if (!(bytes instanceof Uint8Array) || bytes.length >= recoveryCaps.lineBytes) throw new RecoveryFormatError();
  try {
    const raw = new TextDecoder('utf-8', {fatal: true}).decode(bytes); const value = captureRecoveryRecord(JSON.parse(raw));
    if (encodeCanonicalJson(value, recoveryCaps.lineBytes - 1) !== raw) throw new RecoveryFormatError(); return value;
  } catch {throw new RecoveryFormatError();}
}
/** Caller feeds every bounded line and calls finish only at actual manifest EOF. */
export class RecoveryManifest {
  private header?: RecoveryHeader;
  private footer = false;
  private failed = false;
  private readonly entries = new Map<string, RecoveryEntry>();
  private files = 0; private directories = 0; private bytes = 0; private manifestBytes = 0; private pathBytes = 0;
  accept(input: unknown): void {
    if (this.failed) throw new RecoveryFormatError();
    try {
      const record = captureRecoveryRecord(input); this.manifestBytes += encodeRecoveryLine(record).length;
      if (this.footer || this.manifestBytes > recoveryCaps.manifestBytes) throw new RecoveryFormatError();
      if (record.kind === 'header') {if (this.header) throw new RecoveryFormatError(); this.header = record; return;}
      if (!this.header) throw new RecoveryFormatError();
      if (record.kind === 'footer') {this.end(record); return;}
      this.entry(record);
    } catch {this.failed = true; throw new RecoveryFormatError();}
  }
  private end(record: Extract<RecoveryRecord, {kind: 'footer'}>): void {
    if (record.files !== this.files || record.directories !== this.directories || record.bytes !== this.bytes) throw new RecoveryFormatError();
    this.footer = true;
  }
  private entry(record: RecoveryEntry): void {
    this.pathBytes += record.path.length;
    if (this.entries.size >= recoveryCaps.entries || this.pathBytes > recoveryCaps.pathBytes || this.entries.has(record.path)) throw new RecoveryFormatError();
    const parent = record.path.split('/').slice(0, -1).join('/');
    if (parent && this.entries.get(parent)?.kind !== 'directory') throw new RecoveryFormatError();
    this.entries.set(record.path, record);
    if (record.kind === 'directory') this.directories++;
    else {this.files++; this.bytes += record.bytes; if (!Number.isSafeInteger(this.bytes)) throw new RecoveryFormatError();}
  }
  finish() {
    if (this.failed || !this.header || !this.footer) throw new RecoveryFormatError();
    for (const [role, path] of Object.entries(this.header.roles)) {
      if (path === null) continue;
      const expected = role === 'outputs' || role === 'inputs' ? 'directory' : 'file';
      if (this.entries.get(path)?.kind !== expected) throw new RecoveryFormatError();
    }
    return Object.freeze({header: this.header, entries: Object.freeze([...this.entries.values()]),
      files: this.files, directories: this.directories, bytes: this.bytes, manifestBytes: this.manifestBytes});
  }
}
