import { expect, it } from 'vitest';
import { parseOptions } from '../../../src/client/cli/options.js';
const common = ['--endpoint', 'http://backend:4311', '--origin', 'http://localhost:8080', '--session-file', '/private/session.json'];
it('accepts explicit private backend and separately configured loopback origin', () => {
  expect(parseOptions(['run', ...common, '--request-file', '/request.json', '--wait-ms', '3600000', '--json'])).toMatchObject({command: 'run', endpoint: 'http://backend:4311', waitMs: 3600000});
});
it.each([
  ['unknown'], ['pair', ...common], ['run', ...common], ['run', ...common, '--request-file', 'relative'],
  ['run', ...common, '--request-file', '/request', '--wait-ms', '0'], ['run', ...common, '--request-file', '/request', '--wait-ms', '3600001'],
  ['run', ...common, '--request-file', '/request', '--wait-ms', '1e3'], ['run', ...common, '--request-file', '/request', '--endpoint', 'http://evil.invalid'],
  ['compare', ...common, '--request-file', '/request', '--wait-ms', '1000'], ['status', ...common, '--organization', 'bad', '--workspace', 'bad', '--run', 'bad'],
  ['pair', ...common, '--token-file', '/token', '--unknown', 'x'],
])('rejects malformed or inapplicable flags without side effects: %j', (...argv) => {expect(() => parseOptions(argv)).toThrow('invalid_input');});
it.each(['http://user:pass@backend:4311', 'http://backend:4311/path', 'http://backend:4311?x=y', 'http://backend:4311#x', 'http://backend:4311/', 'file:///private/token'])('rejects noncanonical credential endpoints %s', endpoint => {
  expect(() => parseOptions(['pair', '--endpoint', endpoint, ...common.slice(2), '--token-file', '/token'])).toThrow('invalid_input');
});
it('rejects remote external origins and oversized argv', () => {
  expect(() => parseOptions(['pair', ...common.slice(0, 2), '--origin', 'http://remote.invalid', ...common.slice(4), '--token-file', '/token'])).toThrow('invalid_input');
  expect(() => parseOptions(['pair', ...common, '--token-file', '/' + 'x'.repeat(1024)])).toThrow('invalid_input');
});
it('accepts a private-network origin only with the explicit opt-in, never a public address or name', () => {
  const at = (origin: string, ...extra: string[]) => ['status', '--endpoint', 'http://backend:4311', '--origin', origin, '--session-file', '/private/session.json', '--organization', '00000000-0000-4000-8000-000000000001', '--workspace', '00000000-0000-4000-8000-000000000002', '--run', '00000000-0000-4000-8000-000000000003', ...extra];
  for (const origin of ['https://10.0.0.5', 'https://172.16.1.1:8443', 'https://192.168.1.20', 'https://[fd12:3456::1]']) {
    expect(() => parseOptions(at(origin)), origin).toThrow('invalid_input');
    expect(parseOptions(at(origin, '--private-network')).origin).toBe(origin);
  }
  for (const origin of ['https://172.32.0.1', 'https://8.8.8.8', 'https://beetle.example', 'https://[2001:db8::1]'])
    expect(() => parseOptions(at(origin, '--private-network')), origin).toThrow('invalid_input');
  expect(parseOptions(at('http://127.0.0.1:8080', '--private-network')).origin).toBe('http://127.0.0.1:8080');
  expect(() => parseOptions(at('https://10.0.0.5', '--private-network', 'yes'))).toThrow('invalid_input');
});
