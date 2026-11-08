import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const key = 'org.beetle-lab.qualification';
export function docker(args: readonly string[], input?: string): string {
  const result = spawnSync('docker', [...args], { input, encoding: 'utf8', timeout: 30_000, maxBuffer: 3_145_728 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr); return result.stdout.trim();
}
export const limits = ['--cpus', '1', '--memory', '512m', '--memory-swap', '512m', '--pids-limit', '128',
  '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--log-driver', 'none',
  '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=67108864'];

/** Names and labels fence every cleanup to this synthetic exercise. Never prune. */
export class Resources {
  readonly id = `beetle-k6-qualify-${randomUUID()}`;
  readonly network = `${this.id}-net`;
  readonly volumes = ['input', 'secrets', 'output'].map(name => `${this.id}-${name}`);
  readonly containers = ['target', 'stage', 'engine', 'read', 'kernel', 'version'].map(name => `${this.id}-${name}`);
  get labels(): string[] { return ['--label', `${key}=${this.id}`]; }
  mount(index: number, target: string, readonly = false): string[] {
    const volume = this.volumes[index]; assert(volume);
    return ['--mount', `type=volume,src=${volume},dst=${target}${readonly ? ',readonly' : ''}`];
  }
  create(): void {
    docker(['network', 'create', '--internal', ...this.labels, this.network]);
    for (const volume of this.volumes) {
      docker(['volume', 'create', ...this.labels, volume]);
      const value = JSON.parse(docker(['volume', 'inspect', volume])) as { Labels: Record<string, string> }[];
      assert.equal(value[0]!.Labels[key], this.id);
    }
  }
  private container(name: string): Record<string, unknown> | null {
    const result = spawnSync('docker', ['container', 'inspect', name], { encoding: 'utf8', timeout: 10_000, maxBuffer: 65_536 });
    if (result.status === 1 && /No such (object|container)/i.test(result.stderr)) return null;
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    return (JSON.parse(result.stdout) as Record<string, unknown>[])[0]!;
  }
  inspect(name: string): Record<string, unknown> { const value = this.container(name); assert(value); return value; }
  cleanup(retainVolumes = false): void {
    const failures: unknown[] = [];
    for (const name of this.containers) {
      try {
        const value = this.container(name); if (!value) continue;
        const config = value.Config as { Labels: Record<string, string> };
        assert.equal(config.Labels[key], this.id); docker(['container', 'rm', '--force', name]);
        assert.equal(this.container(name), null);
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Container cleanup unconfirmed; volumes retained');
    if (retainVolumes) return;
    for (const volume of this.volumes) {
      const value = JSON.parse(docker(['volume', 'inspect', volume])) as { Labels: Record<string, string> }[];
      assert.equal(value[0]!.Labels[key], this.id); docker(['volume', 'rm', volume]);
    }
    const network = JSON.parse(docker(['network', 'inspect', this.network])) as { Labels: Record<string, string> }[];
    assert.equal(network[0]!.Labels[key], this.id); docker(['network', 'rm', this.network]);
  }
}
