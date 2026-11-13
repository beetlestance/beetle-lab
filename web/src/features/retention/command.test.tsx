// @vitest-environment jsdom
import { expect,it,vi } from 'vitest';
import { act,renderHook } from '@testing-library/react';
import { ApiContext } from '../../app/api.js';
import { testClient,deferred } from '../../app/test-fixtures.js';
import { useRetentionCommand } from './useCommand.js';
import type { ApiClientResult } from '@beetle/contracts/api';
it('fences a valid late mutation reply after scope retirement and preserves one original for explicit retry',async()=>{
 const api=testClient(()=>{throw Error('No HTTP expected');});const accept=vi.fn();const held=deferred<ApiClientResult<number>>();let signal:AbortSignal|undefined;
 const action=vi.fn((current:AbortSignal)=>{signal=current;return held.promise;});
 const hook=renderHook(({identity})=>useRetentionCommand(identity),{initialProps:{identity:'scope-a'},wrapper:({children})=><ApiContext.Provider value={api.client}>{children}</ApiContext.Provider>});
 act(()=>hook.result.current.start(action,accept));expect(action).toHaveBeenCalledTimes(1);act(()=>hook.result.current.start(action,accept));expect(action).toHaveBeenCalledTimes(1);
 hook.rerender({identity:'scope-b'});expect(signal?.aborted).toBe(true);await act(async()=>{held.resolve({ok:true,value:42});await held.promise;});expect(accept).not.toHaveBeenCalled();expect(hook.result.current.pending).toBe(false);
 hook.unmount();
});
