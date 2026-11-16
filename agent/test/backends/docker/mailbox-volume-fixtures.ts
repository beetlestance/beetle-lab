import type { DockerReply, DockerRequest } from '../../../src/backends/docker/index.js';
import { FakeDocker, makeInput, makePlan } from './fixtures.js';
export class LiveDocker extends FakeDocker {
  volume: Record<string, unknown> | undefined;
  override respond(input: DockerRequest): DockerReply {
    if (!input.path.startsWith('/v1.47/volumes/')) return super.respond(input);
    if (input.method === 'GET') return {ok: true, status: this.volume ? 200 : 404, body: this.volume ?? null};
    if (input.method === 'POST') {
      const body = input.body as {Name: string; Labels: unknown; DriverOpts: unknown};
      this.volume = {Name: body.Name, Driver: 'local', Scope: 'local', Labels: body.Labels, Options: body.DriverOpts};
      return {ok: true, status: 201, body: this.volume};
    }
    this.volume = undefined; return {ok: true, status: 204, body: null};
  }
}
export function liveFixture() {
  const input = makeInput();
  const plan = makePlan({...input, profile: {...input.profile, liveMetricMailbox: true}});
  return {plan, docker: new LiveDocker(plan)};
}
