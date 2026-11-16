# Suite configuration/history context
ConfigurationSummary uses an already-loaded saved revision; bounded literal schedule
projection, origin only, no compiler/secrets/body access or new config reads/storage.
SuiteLatestRun reads one indexed suite-filtered Run and links the full history context.
Errors are unknown; no polling; query key includes scope, suite and all filters.
Tests: configuration and UI/latest/scope; backend/client suite-filter tests.
