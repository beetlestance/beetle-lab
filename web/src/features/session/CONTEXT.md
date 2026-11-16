# Browser session gate

Public entry: SessionApp in index.tsx; the host supplies a Router, trusted baseUrl,
and optional trusted fetch adapter. autoOpen defaults true; paired-profile test/
developer hosts may explicitly disable that exchange. Session is checked before App/resource queries
mount. BrowserSessionGate owns one abort controller per session epoch, typed API
calls, transient memory-only CSRF, and 401 fencing. App remounts with a new key.
Credentials stay in the HttpOnly browser cookie and private server metadata; CSRF
stays in memory. No localStorage credentials, polling or resource mutation retries.
GET precedes automatic same-origin POST/custom-header exchange; only explicit
paired401 shows tokens. Pending auth503 can reconcile through explicit reconnect.
Unknown automatic exchange first reads session once; logout stays signed out until
reconnect/reload. Unknown pairing first reads session once; the one-time token is never replayed.
Logout aborts resources before sending its separately scoped request. Unknown
logout requires an explicit status read. Retired responses cannot restore App.
Transport deadlines/bounds stay with the existing typed API client.
Paired state includes one bounded input-transfer client. Epoch abort retires it;
replacement waits for original fetch/read/cancel/crypto work to drain. Failed
cleanup fences replacement until the browser view is reloaded. Byte-route401
retires authority; late response bodies stay with the byte client's cleanup owner.
Epoch transition reserves its captured identity before foreign cleanup or listener
publication; a reentrant transition cannot make the outer action adopt a newer epoch.
Check: NODE_OPTIONS=--max-old-space-size=1024 npx --no-install vitest run web/src/features/session --maxWorkers=2.
