// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, readNamespace, testClient } from '../test-fixtures.js';

afterEach(cleanup);
describe('connection banner', () => {
  it('names the address when no reply arrives and clears after a successful retry', async () => {
    let available = false;
    const api = testClient((request) => {
      if (!available) throw new Error('PRIVATE synthetic exception must never be displayed');
      return readNamespace(request);
    });
    mount(api.client);
    expect(await screen.findByText(`Lost connection to Beetle at ${window.location.origin}`)).toBeVisible();
    expect(screen.getByText('Nothing has loaded yet. Check that Beetle Lab is running.')).toBeVisible();
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
    available = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
    await waitFor(() => expect(screen.queryByText(/Lost connection to Beetle/)).not.toBeInTheDocument());
  });
});
