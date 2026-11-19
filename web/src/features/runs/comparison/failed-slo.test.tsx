// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { snapshot } from './fixtures.js';
import { ComparisonFailedSlos } from './FailedSlos.js';
afterEach(cleanup);
it('explains native failure against the captured limit without regrading an apparently passing reading',()=>{
 const items=snapshot().items;items[0]!.result={...items[0]!.result!,outcome:'failed',failedSloCount:1,firstFailedSlo:{id:'tail',reading:{source:'native-summary',metric:'http_req_duration',stat:'p99',value:0},limit:{metric:'http_req_duration',stat:'p99',operator:'<',value:300}}};
 render(<ComparisonFailedSlos items={items}/>);expect(screen.getByRole('list',{name:'Native failed SLOs'})).toHaveTextContent('p99 latency failed: 0 ms; limit under 300 ms.');
});
it('keeps absent legacy details and partial evidence explicit',()=>{
 const items=snapshot().items;items[0]!.result={...items[0]!.result!,outcome:'inconclusive',completeness:'partial',failedSloCount:2};
 render(<ComparisonFailedSlos items={items}/>);expect(screen.getByText(/detail unavailable/)).toHaveTextContent('partial native evidence');
});
it('keeps a captured limit visible when native reading was not recorded',()=>{
 const items=snapshot().items;items[0]!.result={...items[0]!.result!,outcome:'failed',failedSloCount:1,firstFailedSlo:{id:'tail',reading:null,limit:{metric:'http_req_duration',stat:'p99',operator:'<',value:300}}};
 render(<ComparisonFailedSlos items={items}/>);expect(screen.getByText(/native reading unavailable/)).toHaveTextContent('limit under 300 ms');
});
