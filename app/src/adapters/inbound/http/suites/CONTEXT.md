# Suite HTTP
Public entrypoint index.ts registers seven generated authenticated operations.
Existing session/origin/CSRF guard runs before parsing; route/body scope must agree.
Use cases validate bounded adapter responses and preserve query authority.
Revision request/detail envelopes <=2MiB; config <=1MiB; pages <=100 summaries.
No upload route, input publication, engine execution or secret resolution.
Test: npx vitest run app/src/adapters/inbound/http/suites.integration.test.ts
