import assert from 'node:assert/strict';
import { mkdir, rename } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { GithubDelivery } from '../../delivery/registry/github-api.js';
import { verifyTag } from '../../delivery/registry/releases.js';
import { archiveProducer } from '../../delivery/producer.js';
import { deliveryDigest, readDeliveryJson } from '../../delivery/files.js';
import { qualificationTag, publicationAsset, qualificationPlan } from './published-value.js';
async function main() {
  const [tagInput, output, extra] = process.argv.slice(2);
  assert(tagInput && output && isAbsolute(output) && !extra);
  const tag = qualificationTag(tagInput);
  await mkdir(output, { mode: 0o700 });
  const api = new GithubDelivery(output);
  const reply = await api.request('GET', `repos/beetlestance/beetle-lab/releases/tags/${tag}`);
  assert(reply.status === 200 && !reply.nextPage);
  const expected = publicationAsset(reply.value, tag);
  const pending = join(output, 'publication-pending.json');
  await archiveProducer({
    executable: 'curl',
    args: [
      '--disable',
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--proto',
      '=https',
      '--proto-redir',
      '=https',
      '--max-time',
      '115',
      `https://github.com/beetlestance/beetle-lab/releases/download/${tag}/publication.json`,
    ],
    destination: pending,
    maximumBytes: expected.bytes,
    timeoutMs: 120000,
  });
  assert.deepEqual(await deliveryDigest(pending, 262144), expected);
  const plan = qualificationPlan(await readDeliveryJson(pending), tag);
  await verifyTag(api, tag, plan.revision);
  await rename(pending, join(output, 'publication.json'));
  console.log(JSON.stringify({ status: 'verified', revision: plan.revision, sourceRunId: plan.sourceRunId }));
}
main().catch(() => {
  console.error('Public qualification input was not verified');
  process.exitCode = 1;
});
