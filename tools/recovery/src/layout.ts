import { relative, join, isAbsolute, normalize } from 'node:path';
import { recoveryPath } from '@beetle/contracts/recovery';
import { RecoveryError } from './types.js';
export interface SourceLayout {
  readonly root: string;
  readonly backend: string;
  readonly installation: string;
  readonly backendConnection: string;
  readonly agent: string;
}
export function sourceLayout(root: string, custom: Partial<Omit<SourceLayout, 'root'>> = {}): SourceLayout {
  if (!isAbsolute(root) || normalize(root) !== root || root.length > 4096) throw new RecoveryError('invalid_input');
  if (Object.keys(custom).some(key => !['backend','installation','backendConnection','agent'].includes(key))) throw new RecoveryError('invalid_input');
  const layout = {root, backend: 'backend', installation: 'config/installation.json',
    backendConnection: 'config/backend-agent.json', agent: 'config/agent.json', ...custom};
  for (const [key, value] of Object.entries(layout)) if (key !== 'root' && !recoveryPath(value)) throw new RecoveryError('invalid_input');
  return Object.freeze(layout);
}
export function relativePath(root: string, absolute: string): string {
  const value = relative(root, absolute); if (!recoveryPath(value)) throw new RecoveryError('invalid_input'); return value;
}
export function outside(source: string, destination: string): void {
  const path = relative(source, destination);
  if (!path || (!isAbsolute(path) && path !== '..' && !path.startsWith('../'))) throw new RecoveryError('conflict');
}
export function sourcePaths(layout: SourceLayout) {
  return {root: layout.root, backend: join(layout.root, layout.backend), metadata: join(layout.root, layout.backend, 'metadata.sqlite'),
    installation: join(layout.root, layout.installation), backendConnection: join(layout.root, layout.backendConnection), agent: join(layout.root, layout.agent)};
}
