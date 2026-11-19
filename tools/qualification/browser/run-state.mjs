import assert from 'node:assert/strict';
import { validateApi } from '@beetle/contracts/api';

/** @typedef {{origin:string, path:string, organizationId:string, workspaceId:string, id:string}} ScopedRoute */
/** @typedef {ScopedRoute & {suiteId:string, revisionId:string, outputBytes:number}} SubmittedRun */
/** @param {string} input @param {'runs' | 'suites'} resource @returns {ScopedRoute} */
function scopedRoute(input, resource) {
  const url = new URL(input);
  assert(['http:', 'https:'].includes(url.protocol));
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Qualification origin must be loopback');
  assert.equal(url.username + url.password, '', 'Qualification URLs cannot carry credentials');
  const match = new RegExp(`^/organizations/([^/]+)/workspaces/([^/]+)/${resource}/([^/]+)$`).exec(url.pathname);
  assert(match && match.slice(1).every((id) => validateApi('Uuid', id).ok), 'Expected the scoped qualification route');
  const [, organizationId, workspaceId, id] = match;
  assert(organizationId && workspaceId && id);
  return { origin: url.origin, path: url.pathname, organizationId, workspaceId, id };
}
/** @param {string} input */
export const runRoute = (input) => scopedRoute(input, 'runs');
/** @param {string} input */
export const suiteRoute = (input) => scopedRoute(input, 'suites');
/** Bind the response to the independently selected suite and revision before following its ID.
 * @param {unknown} body
 * @param {ScopedRoute} suite
 * @param {string} revisionId
 * @returns {SubmittedRun}
 */
export function submittedRun(body, suite, revisionId) {
  const parsed = validateApi('Run', body);
  assert(parsed.ok, 'Expected a valid submitted Run');
  const run = parsed.value;
  assert.equal(run.scope.organizationId.toLowerCase(), suite.organizationId.toLowerCase());
  assert.equal(run.scope.workspaceId.toLowerCase(), suite.workspaceId.toLowerCase());
  assert.equal(run.suiteId.toLowerCase(), suite.id.toLowerCase());
  assert.equal(run.revisionId.toLowerCase(), revisionId.toLowerCase());
  return {
    ...runRoute(`${suite.origin}/organizations/${suite.organizationId}/workspaces/${suite.workspaceId}/runs/${run.id}`),
    suiteId: run.suiteId,
    revisionId: run.revisionId,
    outputBytes: run.budget.outputBytes,
  };
}
/**
 * @param {unknown} body
 * @param {ScopedRoute} key
 * @param {Pick<import('@beetle/contracts/api').Run, 'state' | 'outcome'>} expected
 * @param {SubmittedRun} submitted
 */
export function checkRunState(body, key, expected, submitted) {
  checkRunRoute(key, submitted);
  const parsed = validateApi('Run', body);
  assert(parsed.ok, 'Expected a valid Run response');
  const run = parsed.value;
  assert.equal(run.id.toLowerCase(), key.id.toLowerCase());
  assert.equal(run.scope.organizationId.toLowerCase(), key.organizationId.toLowerCase());
  assert.equal(run.scope.workspaceId.toLowerCase(), key.workspaceId.toLowerCase());
  assert.equal(run.suiteId.toLowerCase(), submitted.suiteId.toLowerCase());
  assert.equal(run.revisionId.toLowerCase(), submitted.revisionId.toLowerCase());
  assert.equal(run.state, expected.state);
  assert.equal(run.outcome, expected.outcome);
}
/** State remains authoritative even though the redesigned UI no longer renders a raw facts table.
 * @param {import('@playwright/test').Page} page
 * @param {Pick<import('@beetle/contracts/api').Run, 'state' | 'outcome'>} expected
 * @param {SubmittedRun} submitted
 */
export async function assertRunState(page, expected, submitted) {
  const key = runRoute(page.url());
  checkRunRoute(key, submitted);
  const reply = await page.request.get(`${key.origin}/api/v2${key.path}`, { maxRedirects: 0 });
  assert.equal(reply.status(), 200, 'Expected the visible run to remain readable');
  checkRunState(await reply.json(), key, expected, submitted);
}

/** @param {ScopedRoute} key @param {SubmittedRun} submitted */
function checkRunRoute(key, submitted) {
  assert.equal(key.origin, submitted.origin);
  assert.equal(key.organizationId.toLowerCase(), submitted.organizationId.toLowerCase());
  assert.equal(key.workspaceId.toLowerCase(), submitted.workspaceId.toLowerCase());
  assert.equal(key.id.toLowerCase(), submitted.id.toLowerCase());
}
