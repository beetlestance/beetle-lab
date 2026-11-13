import type { DockerReply, DockerRequest } from '../../../src/backends/docker/index.js';
import { LiveDocker } from './mailbox-volume-fixtures.js';
export const daemonId = 'synthetic-retirement-daemon';
/** Models original-ID lookup independently of the current container name. */
export class RetiredDocker extends LiveDocker {
  daemonId = daemonId;
  override respond(input: DockerRequest): DockerReply {
    if (input.path === '/v1.47/info') {
      const value = super.respond(input); if (!value.ok) return value;
      return { ...value, body: { ...(value.body as object), ID: this.daemonId, NCPU: 14, MemTotal: 16 * 1024 ** 3 } };
    }
    const match = /^\/v1\.47\/containers\/([a-f0-9]{64})\/json$/.exec(input.path);
    if (input.method === 'GET' && match) return { ok: true, status: this.state?.Id === match[1] ? 200 : 404,
      body: this.state?.Id === match[1] ? this.state : null };
    return super.respond(input);
  }
}
