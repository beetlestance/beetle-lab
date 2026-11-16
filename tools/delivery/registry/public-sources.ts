import {join} from 'node:path';
import {archiveProducer} from '../producer.js';
import {deliveryDigest, readDeliveryJson} from '../files.js';
import type {RegistryPlan} from './value.js';
import {releaseTag, planCandidates} from './value.js';
import type {GithubApi} from './github-api.js';
import {ensureRelease, ensureAsset, publishRelease} from './releases.js';
import {verifySourceMetadata} from './sources.js';
export async function publishSources(api: GithubApi, plan: RegistryPlan, sourceDirectory: string, output: string): Promise<void> {
  verifySourceMetadata(await readDeliveryJson(join(sourceDirectory, 'source-bundle.json')), plan.revision, planCandidates(plan));
  const release = await ensureRelease(api, releaseTag(plan, true), plan.revision,
    `Source and notice material for qualified candidate ${plan.revision}, CI run ${plan.sourceRunId}.\n\nImage publication and native pull qualification are separate steps.`);
  const archive = join(sourceDirectory, 'sources.tar.gz');
  const actual = await deliveryDigest(archive, 640 * 1024 ** 2);
  if (actual.bytes !== plan.sources.bytes || actual.sha256 !== plan.sources.sha256) throw Error('Publication source bytes changed');
  await ensureAsset(api, release, archive, actual);
  const metadata = join(sourceDirectory, 'source-bundle.json');
  await ensureAsset(api, release, metadata, await deliveryDigest(metadata, 262144));
  await publishRelease(api, release);
  // Disable curl configuration and pass no credentials: prove actual public body availability.
  const downloaded = join(output, 'anonymous-sources.tar.gz');
  await archiveProducer({executable: 'curl', args: ['--disable', '--silent', '--show-error', '--fail', '--location',
    '--proto', '=https', '--proto-redir', '=https', '--max-time', '115', plan.sources.url],
    destination: downloaded, maximumBytes: plan.sources.bytes});
  const checked = await deliveryDigest(downloaded, plan.sources.bytes);
  if (checked.bytes !== plan.sources.bytes || checked.sha256 !== plan.sources.sha256) throw Error('Public source readback mismatch');
}
