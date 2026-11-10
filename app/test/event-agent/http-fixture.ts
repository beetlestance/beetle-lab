import { afterEach } from 'vitest';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { loaded } from '../runner/fixtures.js';
import type { AgentFixture } from './agent-fixture.js';

/** App-side gateway; the actual HTTP server belongs to the separate agent child. */
export function agentHttpFixture() {
  const handles = new Set<{ close(): Promise<void> }>();
  afterEach(async () => { await Promise.all([...handles].map(handle => handle.close())); });
  return async (agent: AgentFixture) => {
    const origin = await agent.listen();
    const gateway = createRunnerGateway({ ...loaded(origin), token: 'S'.repeat(64) });
    const handle = { async close() {
      try { await gateway.close(); await agent.stopServer(); } finally { handles.delete(handle); }
    } };
    handles.add(handle);
    return { gateway, traffic: () => agent.traffic(), configure: (input: Parameters<AgentFixture['configure']>[0]) => agent.configure(input), close: handle.close };
  };
}
