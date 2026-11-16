import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {candidateRoles, imageIdentity} from './identity.js';
import type {CandidateRole} from './identity.js';
export type ImageReferences = Readonly<Record<CandidateRole, string>>;
export type DockerCommand = (args: readonly string[]) => Buffer;
export const localDocker: DockerCommand = args => execFileSync('docker', ['--context', 'default', ...args],
  {timeout: 15000, maxBuffer: 262144, stdio: ['ignore', 'pipe', 'pipe']});
export function archiveReferences(nonce: string = randomUUID()): ImageReferences {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(nonce)) throw Error('Invalid archive nonce');
  return Object.freeze(Object.fromEntries(candidateRoles.map(role =>
    [role, `beetle-qualified-${nonce}/${role}:transport`])) as Record<CandidateRole, string>);
}
function inspect(command: DockerCommand, reference: string): {id: string; tags: string[]} {
  const rows: unknown = JSON.parse(command(['image', 'inspect', reference]).toString('utf8'));
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw Error('Invalid archive reference inspection');
  const row = rows[0] as Record<string, unknown>;
  if (!Array.isArray(row.RepoTags) || row.RepoTags.some(tag => typeof tag !== 'string')) throw Error('Invalid archive reference tags');
  return {id: imageIdentity(row.Id), tags: row.RepoTags as string[]};
}
/** Local transport names only; never a registry target or authority to rebuild. */
export class ArchiveNames {
  readonly references = archiveReferences();
  private readonly created: CandidateRole[] = [];
  constructor(private readonly images: ImageReferences, private readonly command: DockerCommand = localDocker) {}
  create(): void {
    for (const role of candidateRoles) {
      const ref = this.references[role]; const id = imageIdentity(this.images[role]);
      if (this.command(['image', 'ls', '--filter', `reference=${ref}`, '--format', '{{.ID}}']).length !== 0) throw Error('Archive reference collision');
      if (inspect(this.command, id).id !== id) throw Error('Source image identity changed');
      // Own uncertain tag outcomes too: cleanup verifies the binding before removing it.
      this.created.push(role); this.command(['image', 'tag', id, ref]);
    }
    this.verify();
  }
  verify(): void {
    for (const role of candidateRoles) if (inspect(this.command, this.references[role]).id !== this.images[role]) throw Error('Archive reference identity changed');
  }
  release(): void {
    for (const role of this.created) {
      const ref = this.references[role];
      if (this.command(['image', 'ls', '--filter', `reference=${ref}`, '--format', '{{.ID}}']).length === 0) continue;
      const current = inspect(this.command, ref);
      if (current.id !== this.images[role]) throw Error('Refuse changed archive reference cleanup');
      // Preserve an originally untagged source rather than deleting its last name.
      if (current.tags.some(tag => tag !== ref)) this.command(['image', 'rm', ref]);
    }
  }
}
