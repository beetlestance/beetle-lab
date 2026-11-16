# Suite domain
Inputs: structurally validated bounded k6 config. Outputs: deterministic deduplicated
input pins; conflicting same-ID references fail. No file, network or secret resolution.
Public entrypoint: index.ts. Pin JSON <=64KiB; config caller bound <=1MiB.
Test: npx vitest run app/test/domain/suites.test.ts
