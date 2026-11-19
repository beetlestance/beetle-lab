import { expect, it } from 'vitest';
import { comparisonRunLabels } from './run-labels.js';
it('keeps distinct prefixes short and expands prefix collisions using source suffixes',()=>{
 const a='abcd0000-0000-4000-8000-000000001111',b='abcd0000-0000-4000-8000-000000002222',c='beef0000-0000-4000-8000-000000003333';
 expect([...comparisonRunLabels([a.toUpperCase(),b,c]).values()]).toEqual(['abcd…1111','abcd…2222','beef']);
});
it('uses the full source UUID when both prefix and suffix collide',()=>{
 const a='abcd0000-0000-4000-8000-000000001111',b='abcd0000-0000-4000-8000-000000011111';
 expect([...comparisonRunLabels([a,b]).values()]).toEqual([a,b]);
});
