import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Fixture } from '../../../../agent/test/container/fixture.js';
import { namespaceCaps } from '../../../../agent/src/staging-namespace/index.js';
import type { AgentRuntimeOptions } from '../../../../app/src/bootstrap/agent-runtime.js';
import { agentContainerArguments } from '../agent-container.js';
import { currentOrigin } from './docker-sidecar.js';

interface Owned {
  Id: string;
  Image: string;
  State: { Running: boolean; ExitCode: number; Health?: { Status: string } };
  Config: { Labels: Record<string, string> };
}
const control = (f: Fixture) => `beetle-control-${f.id}`;
function inspectAgent(f: Fixture): Owned {
  const value = f.docker.json<Owned[]>(['inspect', f.agent])[0]!;
  assert.equal(value.Config.Labels['dev.beetle.qualification'], f.id);
  assert.equal(value.Image, f.agentImage.Id);
  return value;
}
export async function waitFor(check: () => Promise<boolean> | boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    assert(Date.now() < until, `Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
/** Stops the serving agent cleanly; the operator guide's `docker compose stop agent`. */
export function stopAgent(f: Fixture): void {
  f.docker.run(['stop', '-t', '10', f.agent]);
  const state = inspectAgent(f).State;
  assert.equal(state.Running, false);
  assert.equal(state.ExitCode, 0);
}
/** Removes the stopped agent container if one exists; the guide's `docker compose rm -f agent`. */
function removeStopped(f: Fixture): void {
  if (f.docker.run(['ps', '-aq', '--filter', `name=^/${f.agent}$`]) === '') return;
  assert.equal(inspectAgent(f).State.Running, false);
  f.docker.run(['rm', f.agent]);
}
/** Starts the existing or a recreated agent and waits for its health check; returns its origin. */
export async function startAgent(f: Fixture, recreate: boolean): Promise<string> {
  if (recreate) {
    removeStopped(f);
    f.docker.run(agentContainerArguments(f, control(f)));
  }
  f.docker.run(['start', f.agent]);
  await waitFor(() => inspectAgent(f).State.Health?.Status === 'healthy', 90_000, 'agent health');
  return currentOrigin(f);
}
export function withOrigin(agent: AgentRuntimeOptions, origin: string): AgentRuntimeOptions {
  const connection = agent.connection;
  return { ...agent, connection: { ...connection, configuration: { ...connection.configuration, origin } } };
}
/** Directory facts as the agent container sees them; Docker Desktop numbers its own inodes. */
function facts(f: Fixture, path: string): string {
  return f.docker.run([...helper(f), 'stat', '-c', '%d %i %u %g %a', path]);
}
function helper(f: Fixture): string[] {
  const staging = join(f.root, 'staging');
  return [
    'run',
    '--rm',
    '--pull',
    'never',
    '--label',
    `dev.beetle.qualification=${f.id}`,
    '--network',
    'none',
    // The agent's own user: the copy keeps the owner the agent sees, and so do the facts read.
    '--user',
    f.user,
    '--cap-drop',
    'ALL',
    '--mount',
    `type=bind,src=${staging},dst=${staging}`,
    '--entrypoint',
    'sh',
    f.agentImage.Id,
    '-c',
    '"$@"',
    'sh',
  ];
}
/**
 * Gives the single task folder and everything under it new inode numbers while keeping owner,
 * group and mode, as a Docker restart can: copy with attributes, remove the original, rename.
 */
export async function renumberTaskFolder(f: Fixture) {
  const entries = (await readdir(join(f.root, 'staging'))).filter((name) => name !== namespaceCaps.markerName);
  assert.equal(entries.length, 1, 'Exactly one task folder is expected before cleanup');
  const path = join(f.root, 'staging', entries[0]!);
  const before = facts(f, path);
  const copy = `${path}.renumbered`;
  f.docker.run([...helper(f), 'sh', '-c', 'cp -a "$1" "$2" && rm -rf "$1" && mv "$2" "$1"', 'sh', path, copy]);
  const after = facts(f, path);
  const [device, inode, ...owner] = before.split(' ');
  const [afterDevice, afterInode, ...afterOwner] = after.split(' ');
  assert.equal(afterDevice, device);
  assert.notEqual(afterInode, inode);
  assert.deepEqual(afterOwner, owner);
  return { before, after };
}
/** The guide's `docker compose run --rm --name <agent> agent <command>` with the agent's own recipe. */
export function oneOff(f: Fixture, command: readonly string[]) {
  removeStopped(f);
  f.docker.run([...agentContainerArguments(f, control(f)), ...command]);
  f.docker.run(['start', f.agent]);
  const code = Number(f.docker.run(['wait', f.agent]));
  const logs = f.docker.logs(inspectAgent(f).Id);
  f.docker.run(['rm', f.agent]);
  const lines = logs
    .split('\n')
    .filter((line) => /^\{"(attemptId|mode)"/.test(line))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { command, code, lines, logs: logs.slice(-4096) };
}
/** Offline Journal facts for one attempt; the agent must be stopped. */
export function journalState(f: Fixture, attemptId: string) {
  const db = new DatabaseSync(join(f.root, 'journal', 'journal.sqlite'), { readOnly: true });
  try {
    const exists = (table: string) => Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE attempt_id=?`).get(attemptId));
    const task = db
      .prepare('SELECT state,anchor_json,reconciliation_json FROM task_staging_namespaces WHERE attempt_id=?')
      .get(attemptId);
    return {
      intent: exists('output_retirement_intents'),
      plan: exists('output_cleanup_plans'),
      progress: exists('output_cleanup_progress'),
      receipt: exists('output_cleanup_receipts'),
      taskState: task?.state ?? null,
      anchor: typeof task?.anchor_json === 'string' ? task.anchor_json : null,
      reconciliation: typeof task?.reconciliation_json === 'string' ? task.reconciliation_json : null,
    };
  } finally {
    db.close();
  }
}
