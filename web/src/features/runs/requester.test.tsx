// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {RunRequester} from './RunRequester.js';
afterEach(cleanup);
it('shows the captured label as inert display metadata without fetching current settings',()=>{
 render(<RunRequester run={{requestedBy:'<Meera & team>'}} />);
 expect(screen.getByText('by <Meera & team>')).toBeVisible();
 expect(document.querySelector('meera')).toBeNull();
 expect(screen.getByTitle(/Configured administrator display name/)).toBeVisible();
});
it.each([{}, {requestedBy:null}])('leaves legacy or unknown requesters explicitly unrecorded',run=>{
 render(<RunRequester run={run} />);expect(screen.getByText('requester not recorded')).toBeVisible();
});
