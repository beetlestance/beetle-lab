import { expect, it } from 'vitest';
import { compiled, dependencies, fixture, input } from './fixtures.js';
import { validateAndCompileSuite } from '../../compiler/suite/validation.js';
import { renderRequest } from '../../runtime/render.js';
import type { RequestPlan } from '../../plan/index.js';
function configured(content: string, format: 'json' | 'text') {
  const pin = input(content); const config = fixture(); config.datasets = []; config.secrets = []; delete config.readiness;
  config.requests = [{ id: 'post', name: 'Large body', method: 'POST', path: '/work', query: {}, headers: {}, assertions: [],
    body: { kind: 'input', format, input: pin.ref } }];
  config.selections = [{ scenarioId: 'main', entries: [{ requestId: 'post', weight: 1, wait: { durationMs: 0, jitterMs: 0 } }] }];
  return { config, deps: dependencies([pin]), pin };
}
function render(plan: RequestPlan) {
  return renderRequest({ target: 'http://synthetic.invalid', plan, scope: { rows: new Map(), secret: () => { throw Error('Unexpected secret'); } },
    timeoutMs: 1000, label: 'r0' });
}
it('round-trips a 700KiB JSON body with literal braces, quotes and Unicode through bounded rendering', () => {
  const value = { html: '<style>.book { color: red; }</style>"\\🙂'.repeat(19000) };
  const content = JSON.stringify(value); expect(Buffer.byteLength(content)).toBeGreaterThan(700000);
  const { config, deps } = configured(content, 'json');
  const suite = compiled(config, deps); expect(JSON.parse(render(suite.requests[0]!).body!)).toEqual(value);
  expect(suite.identity.inputs).toEqual(deps.inputs.map(item => item.ref));
});
it('preserves a large text input byte-for-byte and retains explicit Content-Type', () => {
  const content = 'literal text { css } 🙂\n'.repeat(30000); const { config, deps } = configured(content, 'text');
  config.requests[0]!.headers = { 'Content-Type': 'text/plain' };
  const request = render(compiled(config, deps).requests[0]!);
  expect(request.body).toBe(content); expect(request.headers['content-type']).toBe('text/plain');
});
it('keeps dynamic template source limits and exact pinned byte/digest checks', () => {
  const setup = configured('x'.repeat(4096) + '{{data.users.user}}', 'text');
  expect(validateAndCompileSuite(setup.config, setup.deps).ok).toBe(false);
  const plain = configured('x'.repeat(700000), 'text');
  expect(validateAndCompileSuite(plain.config, dependencies([{ ...plain.pin, content: plain.pin.content+'!' }])).ok).toBe(false);
});
it('rejects over-limit inputs and rendered bytes instead of truncating a literal', () => {
  const tooLarge = configured('x'.repeat(8388609), 'text');
  expect(validateAndCompileSuite(tooLarge.config, tooLarge.deps).ok).toBe(false);
  const setup = configured('a🙂'.repeat(1000), 'text');const plan = compiled(setup.config, setup.deps).requests[0]!;
  expect(() => render({ ...plan, serialization: { ...plan.serialization, bodyBytes: 4999 } })).toThrow();
  expect(Buffer.byteLength(render({ ...plan, serialization: { ...plan.serialization, bodyBytes: 5000 } }).body!)).toBe(5000);
});
it('charges repeated large input bodies against the unchanged aggregate expansion budget', () => {
  const setup = configured('x'.repeat(1100000), 'text');const base = setup.config.requests[0]!;
  setup.config.requests = Array.from({ length: 32 }, (_, i) => ({ ...base, id: 'r'+i, name: 'Body '+i }));
  setup.config.selections[0]!.entries[0]!.requestId = 'r0';
  expect(validateAndCompileSuite(setup.config, setup.deps)).toMatchObject({ ok: false, issues: [{ code: 'input_limit' }] });
});
