import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { INSTALLATION_RECEIPT_BYTES } from '@beetle/contracts/installation-generation';
import { readPrivateFile } from '../providers/index.js';
export const receiptDigest = (value: string) => createHash('sha256').update(value).digest('hex');
async function read(path: string): Promise<string | undefined> {
  try { await lstat(path); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('Installation receipt is required', {cause:error});
    throw error;
  }
  const bytes = await readPrivateFile(path, INSTALLATION_RECEIPT_BYTES);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  finally { bytes.fill(0); }
}
/** Rechecked under the serving lease to refuse stale pre-maintenance configuration. */
export async function captureInstallationReceipt(configPath: string, receiptPath?: string) {
  const path = receiptPath ?? join(dirname(configPath), 'configuration-state.json');
  const original = await read(path);
  const value: unknown = original === undefined ? undefined : JSON.parse(original);
  return { value, async assertCurrent() {
    if (await read(path) !== original) throw new Error('Installation configuration changed during startup');
  } };
}
