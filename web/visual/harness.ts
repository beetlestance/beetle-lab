// Shared screenshot harness. Every test opens the built app, answers every API call from
// fixtures, fixes the clock, and takes full-page screenshots per viewport. A request
// no fixture answers fails the test, so a screen can never silently render an error state.
import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import type { Page, Request, Route } from '@playwright/test';

/** Board sizes from Penpot: desktop 1440, phone 390, tablet 834, ultrawide 2560. */
export const viewports = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
  tablet: { width: 834, height: 1194 },
  ultrawide: { width: 2560, height: 1080 },
} as const;
export type ViewportName = keyof typeof viewports;

/** Wall clock every screen sees: matches the boards' "Today, 23:35" style times. */
export const NOW = '2026-11-07T23:40:00.000Z';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** A fixture reply: a JSON body (status 200), an explicit status/body, or a request left pending. */
export type Reply = Json | { status: number; body?: Json; headers?: Record<string, string> } | 'pending';
export interface Call {
  readonly operation: string;
  readonly method: string;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly body: Json | undefined;
  /** How many times this operation was called before, counting from 0. */
  readonly index: number;
}
export type Handler = Reply | ((call: Call) => Reply);

interface Operation {
  readonly name: string;
  readonly method: string;
  readonly pattern: RegExp;
  readonly keys: readonly string[];
}
const operations: readonly Operation[] = (
  JSON.parse(readFileSync(new URL('../../contracts/api/v2/http-operations.json', import.meta.url), 'utf8')) as {
    name: string;
    method: string;
    path: string;
  }[]
).map(({ name, method, path }) => {
  const keys: string[] = [];
  const source = path.replace(/\{(\w+)\}/g, (_, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { name, method, pattern: new RegExp(`^${source}$`), keys };
});
/** Literal segments ("profiles", "latest") must win over a parameter in the same position. */
const ordered = [...operations].sort((a, b) => a.keys.length - b.keys.length);

function isStatus(reply: Reply): reply is { status: number; body?: Json; headers?: Record<string, string> } {
  return typeof reply === 'object' && reply !== null && !Array.isArray(reply) && typeof reply.status === 'number';
}

/** Fixture API for one test: named operations, raw byte routes, and strict unhandled-call tracking. */
export class Api {
  private readonly handlers = new Map<string, Handler>();
  private readonly raw: { pattern: RegExp; handler: (route: Route) => Promise<void> }[] = [];
  private readonly counts = new Map<string, number>();
  readonly calls: Call[] = [];
  readonly unhandled: string[] = [];

  /** Answers an operation by its name in http-operations.json. Later calls replace earlier ones. */
  on(operation: string, handler: Handler): this {
    if (!operations.some((op) => op.name === operation)) throw new Error(`Unknown operation ${operation}`);
    this.handlers.set(operation, handler);
    return this;
  }
  /** Byte and download routes that are not JSON operations. */
  route(pattern: RegExp, handler: (route: Route) => Promise<void>): this {
    this.raw.push({ pattern, handler });
    return this;
  }
  async install(page: Page): Promise<void> {
    await page.route('**/api/**', (route) => this.answer(route));
  }
  private match(method: string, pathname: string) {
    for (const op of ordered) {
      const found = op.method === method ? op.pattern.exec(pathname) : null;
      if (found)
        return { op, params: Object.fromEntries(op.keys.map((key, i) => [key, decodeURIComponent(found[i + 1]!)])) };
    }
    return undefined;
  }
  private call(name: string, request: Request, url: URL, params: Record<string, string>): Call {
    const index = this.counts.get(name) ?? 0;
    this.counts.set(name, index + 1);
    const text = request.postData();
    const call: Call = {
      operation: name,
      method: request.method(),
      params,
      query: url.searchParams,
      body: text ? (JSON.parse(text) as Json) : undefined,
      index,
    };
    this.calls.push(call);
    return call;
  }
  private async answer(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const raw = this.raw.find((entry) => entry.pattern.test(url.pathname + url.search));
    if (raw) return raw.handler(route);
    const match = this.match(request.method(), url.pathname);
    const handler = match ? this.handlers.get(match.op.name) : undefined;
    if (!match || handler === undefined) {
      this.unhandled.push(`${request.method()} ${url.pathname}${url.search}`);
      return route.fulfill({ status: 501, contentType: 'application/json', body: '{}' });
    }
    const call = this.call(match.op.name, request, url, match.params);
    const reply = typeof handler === 'function' ? handler(call) : handler;
    if (reply === 'pending') return; // Left unanswered: loading states.
    const { status, body, headers } = isStatus(reply) ? reply : { status: 200, body: reply, headers: undefined };
    return route.fulfill({
      status,
      headers: { 'cache-control': 'no-store', ...headers },
      contentType: 'application/json',
      body: body === undefined ? '' : JSON.stringify(body),
    });
  }
}

export type Skin = 'darkroom' | 'scarab';
interface Fixtures {
  api: Api;
  skin: Skin;
}

/** The Playwright test with `api` (strict fixtures) and `skin` (from the project). */
export const test = base.extend<Fixtures>({
  skin: ['darkroom', { option: true }],
  api: async ({ page, skin }, use) => {
    const api = new Api();
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('beetle.theme', value);
      } catch {
        /* Storage unavailable: the app falls back to darkroom. */
      }
    }, skin);
    await api.install(page);
    await use(api);
    expect(api.unhandled, 'every API call needs a fixture').toEqual([]);
  },
});
export { expect };

export interface ShotOptions {
  /** Viewports to capture; defaults to desktop only. */
  readonly viewports?: readonly ViewportName[];
  /** Waits for this before each screenshot; defaults to the main landmark. */
  readonly ready?: (page: Page) => Promise<void>;
  /** Captures only the viewport instead of the full scrollable page (dialogs, menus). */
  readonly viewportOnly?: boolean;
}

/** Opens `path` and captures one screenshot per viewport, named `<name>-<viewport>.png`. */
export async function shoot(page: Page, path: string, name: string, options: ShotOptions = {}): Promise<void> {
  for (const viewport of options.viewports ?? ['desktop']) {
    await page.setViewportSize(viewports[viewport]);
    await page.goto(path);
    await settle(page, options.ready);
    await capture(page, `${name}-${viewport}`, options);
  }
}

/** Screenshot of the current page state, for states reached by clicking or typing. */
export async function capture(page: Page, name: string, options: Pick<ShotOptions, 'viewportOnly'> = {}) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: !options.viewportOnly });
}

export async function settle(page: Page, ready?: (page: Page) => Promise<void>): Promise<void> {
  if (ready) await ready(page);
  else {
    // Route chunks load lazily and queries settle after; loading-state cases pass their own `ready`.
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.getByText(/^Loading\b/)).toHaveCount(0);
  }
  await page.evaluate(() => document.fonts.ready);
}
