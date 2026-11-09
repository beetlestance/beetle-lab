import { AgentRuntimeError } from './types.js';

/** Trusted installation path; the control store validates bounds and canonical parents. */
export function installationStatePath(journalPath: string): string {
  if (typeof journalPath !== 'string') throw new AgentRuntimeError('startup');
  return journalPath + '.authority.sqlite';
}
