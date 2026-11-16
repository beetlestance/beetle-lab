/** Native source-built images: separate from anonymous published-image proof. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {fixture} from '../compose/fixture.js';
import {configuration, qualificationCases} from '../../resources/lifecycle/configuration.js';
import {executeLifecycle} from '../../resources/lifecycle/execution.js';
async function main() {
  const [output, mode, ...images] = process.argv.slice(2);
  assert(output && isAbsolute(output) && mode && images.length === 6); qualificationCases(mode);
  const expected = process.env.BEETLE_QUALIFICATION_REVISION; assert(expected && /^[a-f0-9]{40}$/.test(expected));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {timeout: 10000, maxBuffer: 1024, encoding: 'utf8'}).trim(); assert.equal(head, expected);
  const config = await configuration(); const f = await fixture([...images, 'default'], 128); assert.equal(f.revision, expected);
  await executeLifecycle({f, config, output, mode});
}
main().catch(() => {console.error('Source-built active recovery did not qualify'); process.exitCode = 1;});
