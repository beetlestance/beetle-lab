declare module 'k6' {
  export function sleep(seconds: number): void;
}
declare module 'k6/http' {
  interface Response { status: number; error_code: number; body: string | null; headers: Record<string, string> }
  interface Params { headers: Readonly<Record<string, string>>; tags: Record<string, string>;
    timeout: number; responseType: 'none' | 'text'; redirects: number }
  const http: { request(method: string, url: string, body: string | null, params: Params): Response };
  export default http;
}
declare module 'k6/execution' {
  const execution: { vu: { idInTest: number; iterationInScenario: number };
    scenario: { startTime: number }; test: { abort(reason: string): never } };
  export default execution;
}
declare module 'k6/metrics' {
  export class Counter {
    constructor(name: string);
    add(value: number, tags?: Readonly<Record<string, string>>): void;
  }
}
/** k6 init-context file loader. Only native.ts calls it, for trusted staged names. */
declare function open(path: string): string;
