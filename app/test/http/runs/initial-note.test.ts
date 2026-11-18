import { expect, it } from 'vitest';
import { runValue } from '../../application/runs/fixture.js';
import { fixture } from './fixture.js';
it('accepts an initial note through run admission and requires it in the receipt', async () => {
  const f=fixture();
  try {
    const headers=await f.paired();
    f.execute.mockResolvedValueOnce({...runValue(),note:'Connection pool fix',noteVersion:1});
    const response=await f.server.inject({method:'POST',url:f.base,headers,payload:{...f.body,note:' Connection pool fix '}});
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({note:'Connection pool fix',noteVersion:1});
    expect(f.execute.mock.calls[0]![0].request.note).toBe(' Connection pool fix ');
    expect(f.setNote).not.toHaveBeenCalled();
    f.execute.mockResolvedValueOnce(runValue());
    const invalid=await f.server.inject({method:'POST',url:f.base,headers,payload:{...f.body,note:'Connection pool fix'}});
    expect(invalid.statusCode).not.toBe(202);
  } finally {await f.close();}
});
