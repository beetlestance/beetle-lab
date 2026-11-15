import {describe, expect, it} from 'vitest';
import {publicationFixture} from '../../delivery/registry/fixture.js';
import {releaseTag} from '../../delivery/registry/value.js';
import {qualificationTag, publicationAsset, qualificationPlan} from './published-value.js';
import {qualificationArchitecture} from './values.js';
const {plan} = publicationFixture(); const tag = releaseTag(plan);
const asset = {name: 'publication.json', state: 'uploaded', size: 40, digest: 'sha256:' + 'b'.repeat(64)};
const release = {tag_name: tag, draft: false, assets: [asset]};
const publication = {format: 'beetle-published-candidate', version: 1, status: 'published', anonymousQualification: 'passed', plan};
describe('read-only native qualification input', () => {
  it('binds each native job to its declared matrix architecture before effects', () => {
    expect(qualificationArchitecture('x64', 'amd64')).toBe('amd64');
    expect(qualificationArchitecture('arm64', 'arm64')).toBe('arm64');
    for (const [host, expected] of [['x64', 'arm64'], ['arm64', 'amd64'], ['ia32', 'amd64'], ['x64', 'x64']]) expect(() => qualificationArchitecture(host!, expected)).toThrow();
  });
  it('accepts the exact completed release, bounded asset and published identities', () => {
    expect(qualificationTag(tag)).toBe(tag);
    expect(publicationAsset(release, tag)).toEqual({bytes: 40, sha256: 'b'.repeat(64)});
    expect(qualificationPlan(publication, tag)).toEqual(plan);
  });
  it('rejects arbitrary, noncanonical and unsafe run tags', () => {
    for (const value of ['main', tag + '/other', tag.replace('-17', '-017'), tag.replace('-17', '-9999999999999999')]) expect(() => qualificationTag(value)).toThrow();
  });
  it('rejects drafts, mismatched releases and ambiguous or unbounded assets', () => {
    for (const row of [{...release, draft: true}, {...release, tag_name: 'main'}, {...release, assets: []},
      {...release, assets: [asset, asset]}, {...release, assets: [{...asset, size: 262145}]},
      {...release, assets: [{...asset, state: 'new'}]}, {...release, assets: [{...asset, digest: null}]}]) expect(() => publicationAsset(row, tag)).toThrow();
  });
  it('rejects pending anonymous qualification and identity mismatches', () => {
    expect(() => qualificationPlan({...publication, anonymousQualification: 'pending'}, tag)).toThrow();
    expect(() => qualificationPlan(publication, tag.replace('-17', '-18'))).toThrow();
  });
});
