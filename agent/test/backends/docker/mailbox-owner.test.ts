import { expect, it } from 'vitest';
import { DockerBackend } from '../../../src/backends/docker/index.js';
import type { MailboxArchiveReply } from '../../../src/backends/docker/index.js';
import { liveFixture } from './mailbox-volume-fixtures.js';
import { operation, makePlan } from './fixtures.js';
const evidence = {sealed: true, applicationAcknowledged: true} as const;
it('reads only a matched running live plan and revokes late results after stop', async () => {
  const {plan, docker} = liveFixture(); const backend = new DockerBackend(docker);
  let finish!: (reply: MailboxArchiveReply) => void; let calls = 0;
  const transport = Object.assign(docker, {readMailboxArchive: () => {calls++; return new Promise<MailboxArchiveReply>(resolve => {finish = resolve;});}});
  expect((await backend.readMailbox(plan, operation())).ok).toBe(false); expect(calls).toBe(0);
  await backend.ensureCreated(plan, operation()); await backend.dispatchStartOnce(plan, operation());
  expect((await backend.readMailbox(makePlan(), operation())).ok).toBe(false);
  const pending = backend.readMailbox(plan, operation()); expect(calls).toBe(1);
  expect(await backend.readMailbox(plan, operation())).toMatchObject({ok: false, reason: 'overflow'});
  await backend.stop(plan, operation(), 0);
  expect((await backend.remove(plan, operation(), evidence)).outcome).toBe('rejected');
  expect(docker.state).toBeDefined(); expect(docker.volume).toBeDefined();
  finish({ok: true, status: 200, image: new Uint8Array(65792)});
  expect(await pending).toMatchObject({ok: false, reason: 'unsafe_state'});
  expect(await backend.remove(plan, operation(), evidence)).toEqual({outcome: 'known', value: 'removed'});
  expect((await backend.readMailbox(plan, operation())).ok).toBe(false); expect(calls).toBe(1);
  expect(transport).toBe(docker);
});
it('contains a throwing raw read while releasing its credit for the same active owner', async () => {
  const {plan, docker} = liveFixture(); Object.assign(docker, {readMailboxArchive: async () => {throw new Error('synthetic');}});
  const backend = new DockerBackend(docker); await backend.ensureCreated(plan, operation()); await backend.dispatchStartOnce(plan, operation());
  expect(await backend.readMailbox(plan, operation())).toMatchObject({ok: false, reason: 'unavailable'});
  Object.assign(docker, {readMailboxArchive: async () => ({ok: true, status: 404, image: null})});
  expect(await backend.readMailbox(plan, operation())).toEqual({ok: true, status: 404, image: null});
});

it('rejects a held read after volume verification is revoked', async () => {
  const {plan, docker} = liveFixture(); let finish!: (reply: MailboxArchiveReply) => void;
  Object.assign(docker, {readMailboxArchive: () => new Promise<MailboxArchiveReply>(resolve => {finish = resolve;})});
  const backend = new DockerBackend(docker); await backend.ensureCreated(plan, operation()); await backend.dispatchStartOnce(plan, operation());
  const pending = backend.readMailbox(plan, operation());
  docker.volume!.Labels = {};
  expect((await backend.inspect(plan, operation())).state).toBe('unknown');
  finish({ok: true, status: 200, image: new Uint8Array(65792)});
  expect(await pending).toMatchObject({ok: false, reason: 'unsafe_state'});
});
