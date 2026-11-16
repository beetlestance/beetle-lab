import {expect, it} from 'vitest';
import {captureArtifactMembers} from './zip.js';
import {candidateRoles} from './identity.js';
it('accepts only the exact bounded files belonging to each artifact kind', () => {
  expect(captureArtifactMembers('images', 'bundle.json\nimages.tar.gz\n')).toHaveLength(2);
  expect(captureArtifactMembers('roundtrip', 'roundtrip.json\n')).toHaveLength(1);
  expect(captureArtifactMembers('native', 'beetle-compose-evidence-uUtxwm/outcome.json\n')).toHaveLength(1);
  const scans = [...candidateRoles.flatMap(role => ['scan.json', 'identity.json', 'licenses.json', 'cdx.json', 'gate.txt']
    .map(suffix => `${role}.${suffix}`)), 'scanner.txt', 'source-dependencies.cdx.json', 'source-audit.json'];
  expect(captureArtifactMembers('supply-chain', scans.join('\n') + '\n')).toHaveLength(33);
});
it.each(['../outcome.json\n', '/outcome.json\n', 'beetle-compose-evidence-uUtxwm/../outcome.json\n',
  'beetle-compose-evidence-*/outcome.json\n', 'outcome.json\noutcome.json\n', 'outcome.json',
  'outcome.json\nextra\n', 'outcome.json\u0000\n'])('refuses ambiguous or unselected native ZIP names %j', listing => {
  expect(() => captureArtifactMembers('native', listing)).toThrow();
});
it('requires every expected image and supply-chain member and refuses extra directories', () => {
  expect(() => captureArtifactMembers('images', 'bundle.json\n')).toThrow();
  expect(() => captureArtifactMembers('images', 'bundle.json\nimages.tar.gz\nextra/\n')).toThrow();
  expect(() => captureArtifactMembers('supply-chain', 'frontend.identity.json\n')).toThrow();
  expect(() => captureArtifactMembers('native', 'x'.repeat(65537) + '\n')).toThrow('bound');
});
