import { describe, expect, it } from 'vitest';
import { validateAndCompileSuite, validateCompileInput, validateSuiteConfig } from '../../compiler/suite/validation.js';
import { dependencies, fixture } from './fixtures.js';
describe('closed suite validation boundary', () => {
  it.each(['file:///tmp/host', 'ftp://synthetic.invalid', 'https://u:p@synthetic.invalid', 'https://synthetic.invalid/#',
    'https://synthetic.invalid/?query', 'https://synthetic.invalid/has space', 'https://synthetic.invalid/\r\nInjected: x', '//synthetic.invalid', 'https://synthetic.invalid\\bad'])('rejects unsafe target %j', target => {
    const config = fixture(); config.target = target;
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
    expect(validateAndCompileSuite(fixture(), { ...dependencies(), targetOverride: target }).ok).toBe(false);
  });
  it.each(['{{eval(1)}}', '{{data.users.user.constructor}}', '{{data.users.__proto__}}', '{{secret.missing}}',
    '{{data.missing.name}}', '{{data.users.missing}}', '{{data.users.user', 'literal}', '${process.env.X}',
    '/{{ data.users.user }}', '{{data.users.user}}'])('rejects hostile/unsupported or missing template %j', path => {
    const config = fixture(); config.requests[0]!.path = path;
    const result = validateAndCompileSuite(config, dependencies());
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(path);
  });
  it.each(['//escape.invalid/x', '/a/../b', '/a/%2e%2e/b', '/%2fescape.invalid', '/x?query', '/x#fragment', '/back\\slash', '/bad%0d%0a', '/bad%zz'])('rejects unsafe relative path %j', path => {
    const config = fixture(); config.requests[0]!.path = path;
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
  it('rejects header injection and duplicate case-folded headers', () => {
    for (const headers of [{ 'X-Header': 'hello\r\nInjected: value' }, { 'Bad\nName': 'value' },
      { Header: 'one', header: 'two' }, { '{{secret.auth}}': 'value' }]) {
      const config = fixture(); config.requests[0]!.headers = headers;
      expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
    }
  });
  it.each(['$.constructor', '$.__proto__', '$.a.prototype', '$..x', '$[*]', '$[-1]', '$[01]', '$[?(@.x)]', '$["a"]', '$[1000000001]', '$' + '.a'.repeat(33)])('rejects unsupported JSONPath %j', path => {
    const config = fixture(); config.requests[0]!.assertions = [{ kind: 'jsonExists', id: 'bad', required: true, path }];
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
  it('rejects unsupported assertions, invalid status families, IDs and header checks', () => {
    const assertions = [
      { id: 'bad', required: true, kind: 'regex', value: '.*' },
      { id: 'bad', required: true, kind: 'statusFamily', value: 6 },
      { id: 'bad', required: true, kind: 'headerExists', name: 'Bad Header' },
      { id: 'bad', required: true, kind: 'headerEquals', name: 'X-Id', value: '\nInjected' },
      { id: 'bad', required: true, kind: 'jsonCompare', path: '$', operator: 'eval', value: 1 },
    ];
    for (const assertion of assertions) {
      const config = { ...fixture(), requests: [{ ...fixture().requests[0], assertions: [assertion] }] };
      expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
    }
    const duplicate = fixture(); duplicate.requests[0]!.assertions.push(duplicate.requests[0]!.assertions[0]!);
    expect(validateAndCompileSuite(duplicate, dependencies()).ok).toBe(false);
  });
  it('rejects scripts, shell fields, paths and legacy aliases without disclosing their values', () => {
    for (const key of ['preStart', 'onStart', 'onStop', 'script', 'shell', 'endpoints', 'bodyFile']) {
      const result = validateAndCompileSuite({ ...fixture(), [key]: 'PRIVATE_CANARY_999' }, dependencies());
      expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY_999');
    }
    const config = fixture(); config.requests[1]!.body = { kind: 'input', input: '/etc/passwd', format: 'text' } as never;
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
  it('does not invoke accessors, toJSON or accept hostile prototypes/cycles', () => {
    let accessed = 0; const getter = fixture(); Object.defineProperty(getter, 'target', { get() { accessed++; return 'PRIVATE'; }, enumerable: true });
    expect(validateSuiteConfig(getter).ok).toBe(false); expect(accessed).toBe(0);
    const toJSON = { ...fixture(), toJSON() { accessed++; return {}; } };
    expect(validateSuiteConfig(toJSON).ok).toBe(false); expect(accessed).toBe(0);
    expect(validateSuiteConfig(Object.assign(Object.create({ inherited: true }) as object, fixture())).ok).toBe(false);
    const config = fixture(); config.requests[0]!.body = { kind: 'json', value: config };
    expect(validateSuiteConfig(config).ok).toBe(false);
    expect(validateSuiteConfig(JSON.parse('{"__proto__":{},"version":1}')).ok).toBe(false);
    const deps = dependencies(); Object.defineProperty(deps, 'engine', { get() { accessed++; return {}; }, enumerable: true });
    expect(validateCompileInput(deps).ok).toBe(false); expect(accessed).toBe(0);
    const items = dependencies(); Object.defineProperty(items.inputs, '0', { get() { accessed++; return {}; }, enumerable: true });
    expect(validateCompileInput(items).ok).toBe(false); expect(accessed).toBe(0);
  });
  it('rejects duplicate dataset/request/secret identities and names', () => {
    const configs = [fixture(), fixture(), fixture(), fixture()];
    configs[0]!.datasets.push(configs[0]!.datasets[0]!);
    configs[1]!.requests.push(configs[1]!.requests[0]!);
    configs[2]!.secrets.push(configs[2]!.secrets[0]!);
    configs[3]!.requests[1]!.name = configs[3]!.requests[0]!.name;
    for (const config of configs) expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
  it('checks every readiness timeout and interval against the explicit wall budget', () => {
    const config = fixture(); config.readiness!.wallBudgetMs = 339;
    expect(validateAndCompileSuite(config, dependencies())).toMatchObject({ ok: false, issues: [{ code: 'readiness' }] });
    config.readiness!.wallBudgetMs = 340; config.readiness!.path = '/{{data.users.user}}';
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
    config.readiness!.path = '/health'; config.readiness!.attempts = 0;
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
    config.readiness!.attempts = 101;
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
  it('rejects bodies with forbidden prototype keys, excessive depth and non-JSON values', () => {
    for (const value of [JSON.parse('{"__proto__":"bad"}'), { constructor: 'bad' }, { '${code}': 'bad' }, { value: undefined }, { value: Infinity }, { value: BigInt(1) }]) {
      const config = fixture(); config.requests[0]!.body = { kind: 'json', value };
      expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
    }
    const config = fixture(); let nested: unknown = null;
    for (let index = 0; index < 33; index++) nested = { child: nested };
    config.requests[0]!.body = { kind: 'json', value: nested };
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
});
