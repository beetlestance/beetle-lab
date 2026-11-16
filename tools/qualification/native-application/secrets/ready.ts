import assert from 'node:assert/strict';
import type {Fixture} from '../compose/fixture.js';
import type {automaticClient} from '../compose/public.js';
import {readReadyPublic} from '../compose/public.js';
import {pause} from '../public-api.js';
import {recoveredAgent} from '../../resources/lifecycle/readiness.js';
/** A config replacement restarts the agent; wait on GETs before any new mutation. */
export async function operatorReady(f: Fixture, client: Awaited<ReturnType<typeof automaticClient>>) {
 const deadline = performance.now() + 30000; let ready = false;
 for (let calls = 0; calls < 60 && performance.now() < deadline; calls++) {
  if (recoveredAgent(f, client.installation.id).ready) {ready = true; break;} await pause();
 }
 assert(ready, 'Configured owned agent did not become ready within budget');
 const settings = await readReadyPublic(signal => client.api.getInstallationSettings({signal})); assert.equal(settings.id, client.installation.id);
}
