import {expect, it, vi} from 'vitest';
import type {Fixture} from '../compose/fixture.js';
import {completedSetup} from './setup.js';
const id = 'a'.repeat(64); const revision = 'b'.repeat(40); const image = 'sha256:' + 'c'.repeat(64);
function fixture(patch: {image?: string; exit?: string; oom?: boolean} = {}) {
 let waited = false;
 const docker = {json: vi.fn(() => [{Id: id, Image: patch.image ?? image,
 Config: {Labels: {'com.docker.compose.project': 'owned', 'org.opencontainers.image.revision': revision}},
 State: {Running: !waited, ExitCode: 0, OOMKilled: patch.oom ?? false}}]),
 run: vi.fn(() => {waited = true; return patch.exit ?? '0';})};
 const compose = vi.fn(() => id);
 return {f: {docker, compose, project: 'owned', revision, imageIds: {installer: image}} as unknown as Fixture, docker, compose};
}
it('waits for the exact owned setup original before granting write readiness', () => {
 const {f, docker, compose} = fixture(); expect(completedSetup(f)).toEqual({exitCode: 0, oomKilled: false});
 expect(compose).toHaveBeenCalledExactlyOnceWith('ps', '-a', '-q', 'setup');
 expect(docker.run).toHaveBeenCalledExactlyOnceWith(['wait', id]); expect(docker.json).toHaveBeenCalledTimes(2);
});
it('refuses another image before waiting and never accepts failed/OOM setup', () => {
 const other = fixture({image: 'sha256:' + 'd'.repeat(64)}); expect(() => completedSetup(other.f)).toThrow(); expect(other.docker.run).not.toHaveBeenCalled();
 for (const patch of [{exit: '1'}, {oom: true}]) expect(() => completedSetup(fixture(patch).f)).toThrow();
});
