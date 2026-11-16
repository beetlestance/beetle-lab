// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, browser, calls, deferred, json, namespace, pair, session, token, unpaired } from './test-fixtures.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('typed browser pairing boundary', () => {
  it('verifies the session before mounting any resource query', async () => {
    const pending = deferred<Response>();
    const api = browser(record => record.path.endsWith('/auth/session') ? pending.promise : namespace(record));
    await waitFor(() => expect(api.records).toHaveLength(1));
    expect(screen.getByRole('status')).toHaveTextContent('Checking local session');
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
    await act(async () => pending.resolve(json(session)));
    expect(await screen.findByRole('button', { name: 'Create organization' })).toBeVisible();
    await screen.findByRole('table', { name: 'Organizations' });
    expect(api.records[1]?.headers.get('X-Beetle-CSRF')).toBe(session.csrfToken);
    expect(api.records.every(record => record.credentials === 'same-origin')).toBe(true);
  });
  it('reloads into a labeled password form and pairs on explicit keyboard submission', async () => {
    const user = userEvent.setup();
    const api = browser(record => {
      if (record.path.endsWith('/auth/session')) return unpaired();
      if (record.path.endsWith('/auth/pair')) return json(session);
      return namespace(record);
    });
    const input = await screen.findByLabelText('Startup token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    await user.click(input);
    await user.keyboard(token + '{Enter}');
    await screen.findByRole('table', { name: 'Organizations' });
    const request = calls(api.records, '/auth/pair')[0];
    expect(request?.body).toEqual({ bootstrapToken: token });
    expect(request?.headers.get('X-Beetle-Pair')).toBe('1');
    expect(request?.headers.has('X-Beetle-CSRF')).toBe(false);
    expect(request?.credentials).toBe('same-origin');
    expect(api.records.every(record => !record.path.includes(token))).toBe(true);
    expect(document.body).not.toHaveTextContent(token);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('beetle.theme')).toBe('system');
    expect(sessionStorage.length).toBe(0);
  });
  it('clears the input immediately and never retains the token after rejected pairing', async () => {
    const pending = deferred<Response>();
    const api = browser(record => record.path.endsWith('/auth/pair') ? pending.promise : unpaired());
    await pair();
    expect(screen.queryByLabelText('Startup token')).not.toBeInTheDocument();
    await act(async () => pending.resolve(unpaired()));
    expect(await screen.findByLabelText('Startup token')).toHaveValue('');
    expect(calls(api.records, '/auth/pair')).toHaveLength(1);
    expect(api.records).toHaveLength(2);
  });
  it.each(['transport', 'response', 'server'] as const)('recovers an unknown %s pairing reply by reading once without resubmitting', async kind => {
    let reads = 0;
    const api = browser(record => {
      if (record.path.endsWith('/auth/session')) return ++reads === 1 ? unpaired() : json(session);
      if (record.path.endsWith('/auth/pair')) {
        if (kind === 'transport') throw new Error('PRIVATE synthetic exception');
        return kind === 'response' ? new Response('unreadable', { status: 200 }) : json(apiError('internal_error'), 500);
      }
      return namespace(record);
    });
    await pair();
    await screen.findByRole('table', { name: 'Organizations' });
    expect(calls(api.records, '/auth/session')).toHaveLength(2);
    expect(calls(api.records, '/auth/pair')).toHaveLength(1);
    expect(document.body).not.toHaveTextContent('PRIVATE');
  });
  it('explains a possibly consumed token when recovery is unpaired; only explicit new input pairs again', async () => {
    const api = browser(record => {
      if (record.path.endsWith('/auth/pair')) throw new Error('lost');
      return unpaired();
    });
    await pair();
    expect(await screen.findByLabelText('Startup token')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('one-time token may have been consumed');
    expect(screen.getByRole('status')).toHaveTextContent('Restart the local service');
    expect(api.records).toHaveLength(3);
    await pair();
    await waitFor(() => expect(api.records).toHaveLength(5));
    expect(calls(api.records, '/auth/pair')).toHaveLength(2);
  });
  it('shows service errors without mounting App or treating a failed status check as pairing', async () => {
    let available = false;
    const api = browser(record => record.path.endsWith('/auth/session')
      ? available ? unpaired() : json(apiError('storage_unavailable'), 503) : namespace(record));
    expect(await screen.findByRole('alert')).toHaveTextContent('Session status could not be verified');
    expect(screen.queryByLabelText('Startup token')).not.toBeInTheDocument();
    expect(api.records).toHaveLength(1);
    available = true;
    fireEvent.click(screen.getByRole('button', { name: 'Check session status' }));
    await screen.findByLabelText('Startup token');
    expect(api.records).toHaveLength(2);
  });
  it('never mounts App if unknown pairing recovery also fails with 5xx', async () => {
    let reads = 0;
    const api = browser(record => {
      if (record.path.endsWith('/auth/session') && ++reads === 1) return unpaired();
      return json(apiError('internal_error'), 500);
    });
    await pair();
    expect(await screen.findByRole('alert')).toHaveTextContent('pairing outcome is unknown');
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(api.records).toHaveLength(3);
  });
  it('uses the existing transport deadline for a stuck pair and recovers with one read', async () => {
    let reads = 0;
    const api = browser(record => {
      if (record.path.endsWith('/auth/pair')) return new Promise<Response>(() => undefined);
      if (record.path.endsWith('/auth/session')) return ++reads === 1 ? unpaired() : json(session);
      return namespace(record);
    });
    await screen.findByLabelText('Startup token');
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    await pair();
    await waitFor(() => expect(calls(api.records, '/auth/pair')).toHaveLength(1));
    expect(timeout).toHaveBeenCalledWith(30_000);
    await act(async () => deadline.abort());
    await screen.findByRole('button', { name: 'Sign out' });
    expect(calls(api.records, '/auth/pair')).toHaveLength(1);
    expect(calls(api.records, '/auth/pair')[0]?.signal?.aborted).toBe(true);
    expect(calls(api.records, '/auth/session')).toHaveLength(2);
  });
});
