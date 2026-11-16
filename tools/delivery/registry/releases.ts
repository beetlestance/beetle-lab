import {basename} from 'node:path';
import {object} from './descriptors.js';
import type {GithubApi, GithubReply} from './github-api.js';
import {GithubDeliveryError} from './github-api.js';
const repo = 'repos/beetlestance/beetle-lab';
function accepted(reply: GithubReply, status: number): unknown {
  if (reply.status !== status || reply.nextPage) throw new GithubDeliveryError(reply.status); return reply.value;
}
function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('Release ID invalid'); return value;
}
function annotatedTarget(target: Record<string, unknown>): string {
  if (target.type !== 'tag' || typeof target.sha !== 'string' || !/^[a-f0-9]{40}$/.test(target.sha)) throw Error('Release tag revision conflict');
  return target.sha;
}
export async function verifyTag(api: GithubApi, tag: string, revision: string, missingAllowed = false): Promise<void> {
  const current = await api.request('GET', `${repo}/git/ref/tags/${tag}`);
  if (missingAllowed && current.status === 404 && !current.nextPage) return;
  let value = object(accepted(current, 200));
  for (let depth = 0; depth < 3; depth++) {
    const target = object(value.object);
    if (target.type === 'commit' && target.sha === revision) return;
    value = object(accepted(await api.request('GET', `${repo}/git/tags/${annotatedTarget(target)}`), 200));
  }
  throw Error('Release tag depth bound');
}
export interface CandidateRelease {id: number; tag: string; draft: boolean; revision: string}
export async function ensureRelease(api: GithubApi, tag: string, revision: string, body: string): Promise<CandidateRelease> {
  await verifyTag(api, tag, revision, true);
  const current = await api.request('GET', `${repo}/releases/tags/${tag}`);
  const value = current.status === 404 ? object(accepted(await api.request('POST', `${repo}/releases`,
    {tag_name: tag, target_commitish: revision, name: `Beetle Lab ${tag}`, body, draft: true, prerelease: true, make_latest: 'false'}), 201))
    : object(accepted(current, 200));
  if (value.tag_name !== tag || typeof value.draft !== 'boolean') throw Error('Release identity mismatch');
  if (value.draft) {if (value.target_commitish !== revision) throw Error('Draft release revision conflict');}
  else await verifyTag(api, tag, revision);
  return {id: id(value.id), tag, draft: value.draft, revision};
}
export async function ensureAsset(api: GithubApi, release: CandidateRelease, file: string, expected: {bytes: number; sha256: string}): Promise<number> {
  const name = basename(file);
  const inspect = async () => {
    const value = accepted(await api.request('GET', `${repo}/releases/${release.id}/assets?per_page=100`), 200);
    if (!Array.isArray(value) || value.length > 100) throw Error('Release asset list bound');
    const matches = value.map(object).filter(asset => asset.name === name);
    if (matches.length > 1) throw Error('Duplicate release asset'); return matches[0];
  };
  let asset = await inspect();
  if (!asset) {if (!release.draft) throw Error('Published release asset missing'); await api.upload(release.tag, [file]); asset = await inspect();}
  if (!asset || asset.state !== 'uploaded' || asset.size !== expected.bytes || asset.digest !== `sha256:${expected.sha256}`) throw Error('Release asset digest conflict');
  return id(asset.id);
}
export async function publishRelease(api: GithubApi, release: CandidateRelease): Promise<void> {
  if (release.draft) {
    await verifyTag(api, release.tag, release.revision, true);
    const value = object(accepted(await api.request('PATCH', `${repo}/releases/${release.id}`, {draft: false, prerelease: true, make_latest: 'false'}), 200));
    if (value.draft !== false || value.tag_name !== release.tag) throw Error('Release publication unconfirmed');
  }
  await verifyTag(api, release.tag, release.revision);
}
