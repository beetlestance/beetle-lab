import {expect, it} from 'vitest';
import {noCanary} from './audit.js';
import {configuration} from './config.js';
it('rejects embedded canaries without putting values in errors', () => {
 expect(() => noCanary(Buffer.from('prefix SECRET_CANARY suffix'), ['SECRET_CANARY'])).toThrow('Private canary escaped');
 try {noCanary('SECRET_CANARY', ['SECRET_CANARY']);} catch (error) {expect(String(error)).not.toContain('SECRET_CANARY');}
 expect(() => noCanary('ordinary output', ['SECRET_CANARY'])).not.toThrow();
});
it('validates the installed env/mounted reference-only suite', () => {
 const config = configuration(); expect(config.secrets.map(secret => secret.provider)).toEqual(['env', 'mounted']);
 expect(config.requests[0]!.headers).toEqual({'X-Environment': '{{secret.environment}}', 'X-Mounted': '{{secret.mounted}}'});
});
