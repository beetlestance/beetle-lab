import { describe, expect, it } from 'vitest';
import { compiled, dependencies, input } from '../suite/fixtures.js';
import { configFor, harness } from './fixtures.js';
import { BoundedText, quoted, utf8Bytes } from '../../runtime/bounds.js';

describe('bounded native request rendering', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)('executes %s with a coherent iteration row', method => {
    const test = harness(compiled(configFor(method)));
    expect(test.iterate().kind).toBe('completed');
    const request = test.requests[0]!;
    expect(request.method).toBe(method);
    expect(request.url).toContain('https://synthetic.invalid/api/');
    expect(request.timeoutMs).toBe(30_000);
    expect(request.label).toBe('r0');
    if (method === 'GET') {
      expect(request.url).toBe('https://synthetic.invalid/api/users/one?n=1');
      expect(request.headers).toMatchObject({ authorization: 'Bearer synthetic-secret-canary', 'x-token': 't1' });
      expect(request.responseType).toBe('text');
    } else {
      expect(request.responseType).toBe('none');
      expect(JSON.parse(request.body!)).toEqual({ user: 'one', list: [null, true, 42], nested: { token: 't1' } });
      expect(request.headers['Content-Type']).toBe('application/json');
    }
  });
  it('encodes query components independently and keeps prefix paths', () => {
    const config = configFor();
    config.datasets[0] = { id: 'users', kind: 'inline', selection: 'byVu', rows: [{ user: 'one', token: 'a&b=🙂 ?' }] };
    config.requests[0]!.query = { 'a&b': '{{data.users.token}}' };
    const test = harness(compiled(config)); test.iterate();
    expect(test.requests[0]!.url).toBe('https://synthetic.invalid/api/users/one?a%26b=a%26b%3D%F0%9F%99%82%20%3F');
  });
  it('supports text inputs without JSON reinterpretation and JSON input templates', () => {
    const config = configFor('POST');
    const text = input('raw {{data.users.user}} "text"');
    config.requests[0]!.body = { kind: 'input', format: 'text', input: text.ref };
    const test = harness(compiled(config, dependencies([text]))); test.iterate();
    expect(test.requests[0]!.body).toBe('raw one "text"');
    expect(test.requests[0]!.headers['Content-Type']).toBeUndefined();
    const json = input('{"user":"{{data.users.user}}"}');
    config.requests[0]!.body = { kind: 'input', format: 'json', input: json.ref };
    const other = harness(compiled(config, dependencies([json]))); other.iterate();
    expect(other.requests[0]!.body).toBe('{"user":"one"}');
  });
  it.each(['//evil.invalid/a', '/%2e%2e/private', '/x?secret', '/x\\y', '/x\r\nLeak: yes'])('rejects unsafe substituted path %j without HTTP', user => {
    const config = configFor();
    config.requests[0]!.path = '/{{secret.auth}}';
    const test = harness(compiled(config), { resolveSecret: () => user.slice(1) });
    expect(test.iterate().kind).toBe('execution'); expect(test.requests).toHaveLength(0);
  });
  it('rejects header injection and oversized UTF-8 URL before HTTP', () => {
    const suite = compiled(configFor());
    const injected = harness(suite, { resolveSecret: () => 'canary\r\nX: injected' });
    expect(injected.iterate()).toMatchObject({ kind: 'execution', code: 'header' });
    expect(injected.requests).toHaveLength(0);
    const config = configFor(); config.requests[0]!.path = '/{{secret.auth}}';
    const large = harness(compiled(config), { resolveSecret: () => '🙂'.repeat(16_384) });
    expect(large.iterate()).toMatchObject({ kind: 'execution', code: 'request_limit' });
    expect(large.requests).toHaveLength(0);
  });
  it('admits body/header serialization before aggregation and enforces private secret bounds', () => {
    const suite = structuredClone(compiled(configFor('POST')));
    suite.requests[0]!.serialization.bodyBytes = 8;
    const test = harness(suite); expect(test.iterate().code).toBe('request_limit'); expect(test.requests).toHaveLength(0);
    const headers = structuredClone(compiled(configFor())); headers.requests[0]!.serialization.headerBytes = 8;
    expect(harness(headers).iterate().code).toBe('request_limit');
    expect(harness(compiled(configFor()), { resolveSecret: () => 'a'.repeat(65_537) }).iterate().code).toBe('secret');
    expect(harness(compiled(configFor()), { resolveSecret: () => { throw new Error('secret-canary'); } }).iterate().code).toBe('secret');
  });
  it('counts UTF-8 and escapes JSON with bounded appends', () => {
    expect(utf8Bytes('aé🙂\ud800')).toBe(10);
    const output = new BoundedText(100); quoted(output, '"\\\n🙂\ud800');
    expect(JSON.parse(output.finish())).toBe('"\\\n🙂\ud800');
    const small = new BoundedText(3); expect(() => small.append('🙂')).toThrow('request_limit');
    const chars = new BoundedText(20, 1); expect(() => chars.append('aa')).toThrow('request_limit');
  });
});
