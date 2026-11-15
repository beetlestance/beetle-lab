import {expect, it} from 'vitest';
import {ensureRelease, ensureAsset, publishRelease} from './releases.js';
import {parseGithubReply} from './github-api.js';
import type {GithubApi, GithubReply} from './github-api.js';
const revision = 'a'.repeat(40); const tag = `rewrite-sources-${revision}-17`; const hash = 'b'.repeat(64);
function fixture() {
  let exists = false; let draft = true; const assets: Record<string, unknown>[] = []; const writes: string[] = [];
  const reply = (status: number, value: unknown): GithubReply => ({status, value, nextPage: false});
  const release = () => ({id: 7, tag_name: tag, target_commitish: revision, draft});
  const api: GithubApi = {
    request: async (method, path, body) => {
      if (method !== 'GET') writes.push(method + ' ' + path);
      if (method === 'POST') {exists = true; expect(body).toMatchObject({draft: true, target_commitish: revision}); return reply(201, release());}
      if (method === 'PATCH') {draft = false; return reply(200, release());}
      if (path.includes('/git/ref/')) return reply(200, {object: {type: 'commit', sha: revision}});
      if (path.includes('/assets?')) return reply(200, assets);
      return exists ? reply(200, release()) : reply(404, {message: 'Not Found'});
    },
    upload: async () => {writes.push('upload'); assets.push({id: 9, name: 'sources.tar.gz', state: 'uploaded', size: 12, digest: `sha256:${hash}`});},
  };
  return {api, writes, assets};
}
it('uploads into a draft, verifies returned digest, then publishes and verifies its commit tag', async () => {
  const f = fixture(); const release = await ensureRelease(f.api, tag, revision, 'synthetic');
  expect(release.draft).toBe(true);
  expect(await ensureAsset(f.api, release, '/synthetic/sources.tar.gz', {bytes: 12, sha256: hash})).toBe(9);
  await publishRelease(f.api, release); expect(f.writes.map(line => line.split(' ')[0])).toEqual(['POST', 'upload', 'PATCH']);
  const repeated = await ensureRelease(f.api, tag, revision, 'synthetic'); const before = f.writes.length;
  await ensureAsset(f.api, repeated, '/synthetic/sources.tar.gz', {bytes: 12, sha256: hash}); await publishRelease(f.api, repeated);
  expect(f.writes).toHaveLength(before);
});
it('refuses conflicting asset bytes and unknown availability without an overwrite or create', async () => {
  const f = fixture(); const release = await ensureRelease(f.api, tag, revision, 'synthetic');
  f.assets.push({id: 10, name: 'sources.tar.gz', state: 'uploaded', size: 12, digest: `sha256:${'c'.repeat(64)}`});
  const before = f.writes.length;
  await expect(ensureAsset(f.api, release, '/synthetic/sources.tar.gz', {bytes: 12, sha256: hash})).rejects.toThrow('conflict');
  expect(f.writes).toHaveLength(before);
  f.api.request = async () => ({status: 503, value: {}, nextPage: false});
  await expect(ensureRelease(f.api, tag, revision, 'synthetic')).rejects.toMatchObject({status: 503}); expect(f.writes).toHaveLength(before);
});
it('projects numeric HTTP status and refuses incomplete reply framing', () => {
  expect(parseGithubReply('HTTP/2.0 404 Not Found\r\nContent-Type: application/json\r\n\r\n{"message":"Not Found"}').status).toBe(404);
  expect(parseGithubReply('HTTP/2.0 200 OK\nLink: <next>; rel="next"\n\n[]').nextPage).toBe(true);
  expect(() => parseGithubReply('network failure private content')).toThrow();
});
it('refuses a wrong existing Git tag or unknown tag availability before creating or publishing releases', async () => {
  for (const status of [200, 503]) {
    const f = fixture(); const original = f.api.request;
    f.api.request = async (method, path, body) => path.includes('/git/ref/')
      ? {status, value: {object: {type: 'commit', sha: 'c'.repeat(40)}}, nextPage: false} : original(method, path, body);
    await expect(ensureRelease(f.api, tag, revision, 'synthetic')).rejects.toThrow(); expect(f.writes).toHaveLength(0);
    await expect(publishRelease(f.api, {id: 7, tag, revision, draft: true})).rejects.toThrow(); expect(f.writes).toHaveLength(0);
  }
});
