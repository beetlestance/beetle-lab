// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,screen,within} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {mount,testClient,readNamespace} from '../../app/test-fixtures.js';
import {routes,referenceDownloads} from '../../app/routes.js';
afterEach(cleanup);
it('opens the shell reference without API calls and selects the generated exact run request',async()=>{
 const api=testClient(()=>{throw Error('Reference must not call the runtime API');});mount(api.client,routes.reference);
 expect(await screen.findByRole('heading',{name:'Public API reference'})).toBeVisible();
 fireEvent.change(screen.getByRole('searchbox',{name:'Filter JSON operations'}),{target:{value:'createRun'}});
 expect(screen.getByRole('status')).toHaveTextContent('1 of 1 matching operations');
 fireEvent.click(screen.getByRole('button',{name:'Inspect createRun'}));
 const request=screen.getByRole('region',{name:'Request body schema'});const schema=JSON.parse(request.textContent!) as {required:string[];properties:Record<string,unknown>};
 expect(schema.required).toEqual(expect.arrayContaining(['scope','requestId','revisionId','budget']));expect(schema.properties).toHaveProperty('engineProfile');
 expect(screen.getByRole('link',{name:'Download agent instructions'})).toHaveAttribute('href',referenceDownloads.skill);
 expect(screen.getByRole('link',{name:'Download schema catalogue'})).toHaveAttribute('download','public-api.json');expect(api.records).toEqual([]);
});
it('uses the ordinary sidebar link and keeps empty search honest',async()=>{
 const api=testClient(readNamespace);mount(api.client);await screen.findByRole('heading',{name:'Organizations'});
 fireEvent.click(screen.getByRole('link',{name:'API reference'}));await screen.findByRole('heading',{name:'Public API reference'});
 const before=api.records.length;fireEvent.change(screen.getByRole('searchbox'),{target:{value:'not-an-operation'}});
 expect(screen.getByText('No matching operations.')).toBeVisible();expect(screen.queryByRole('region',{name:'Selected operation'})).not.toBeInTheDocument();
 expect(api.records).toHaveLength(before);expect(within(screen.getByRole('navigation',{name:'Main navigation'})).getByRole('link',{name:'Organizations'})).toBeVisible();
});
