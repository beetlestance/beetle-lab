// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import { ComparisonSlos } from './Slos.js';
import { snapshot } from './fixtures.js';
afterEach(cleanup);
it('keeps each native verdict and actual reading/limit even when numbers appear contradictory',()=>{
 const items=snapshot().items;items[0]!.result!.slos=[{id:'tail',passed:true,reading:{source:'native-summary',metric:'http_req_duration',stat:'p99',value:400},limit:{metric:'http_req_duration',stat:'p99',operator:'<',value:300}}];items[1]!.result!.slos=[{id:'tail',passed:false,reading:{source:'native-summary',metric:'http_req_duration',stat:'p99',value:0},limit:{metric:'http_req_duration',stat:'p99',operator:'<',value:350}}];
 render(<ComparisonSlos items={items}/>);const row=screen.getByRole('rowheader',{name:'tail'}).closest('tr')!;
 expect(within(row).getByText('Passed')).toBeVisible();expect(within(row).getByText('Failed')).toBeVisible();expect(row).toHaveTextContent('400 ms');expect(row).toHaveTextContent('0 ms');expect(row).toHaveTextContent('limit under 350 ms');
});
it('distinguishes unavailable legacy evidence, absent rules and missing native readings',()=>{
 const items=snapshot().items;items[0]!.result!.slos=[{id:'tail',passed:true,reading:null,limit:null}];
 const view=render(<ComparisonSlos items={items}/>);expect(screen.getByText('Unavailable',{exact:true})).toBeVisible();expect(screen.getByText('Native reading unavailable.')).toBeVisible();
 items[1]!.result!.slos=[];view.rerender(<ComparisonSlos items={[...items]}/>);expect(screen.getByText('Not recorded')).toBeVisible();
});
it('renders at most32rows and pages the bounded union without dropping rules',()=>{
 const items=snapshot().items;items[0]!.result!.slos=Array.from({length:33},(_,i)=>({id:'rule'+i,passed:true,reading:null,limit:null}));items[1]!.result!.slos=[];
 render(<ComparisonSlos items={items}/>);const table=screen.getByRole('table',{name:'Native SLO verdicts and saved limits'});expect(within(table).getAllByRole('row')).toHaveLength(33);expect(screen.queryByRole('rowheader',{name:'rule32'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Next thresholds'}));expect(within(table).getAllByRole('row')).toHaveLength(2);expect(screen.getByRole('rowheader',{name:'rule32'})).toBeVisible();expect(screen.getByText('33–33 of 33')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Previous thresholds'}));expect(screen.getByRole('rowheader',{name:'rule0'})).toBeVisible();
});
