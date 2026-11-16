# Bounded literal request bodies

Status: accepted correction to the k6 compiler/runtime body contract.
Owner: existing shared suite compiler and renderer; no second compiler or runner.

Body input references retain exact immutable scope/hash/bytes and existing8MiB
input/body byte ceilings. Loaded content retains the shared32MiB expansion budget;
config stays1MiB, JSON nodes/depth stay bounded, and serialized build/output limits
are unchanged. Large bodies use published inputs rather than embedding them in
configuration. No widening of URL/header/dataset/template limits is authorized.

A JSON string without double-brace template delimiters is a literal BodyNode
scalar. Preserve its Unicode, braces and escaping; bounded JSON quoting writes
under the request body byte cap. Strings containing template delimiters retain
the4096-character template source and65536-character substitution limits.
A text input without template delimiters is a literal input plan, appended under
the body byte cap. Text containing delimiters uses the existing template plan.
No raw JSON.stringify or unbounded materialization bypasses the bounded renderer.
Native plan serialization streams quoted chunks for compiler-marked literal body
fields only, under an8MiB expanded-string ceiling and the existing24MiB total/
peak build admission. Unrelated strings and keys retain their65536-character cap.

Acceptance: published approximately700KiB JSON values round-trip and text is byte-exact;
Unicode/escaping, reused references and native build/run keep limits. Oversized
input, rendered bytes, dynamic templates and aggregate expansion fail explicitly.
Source integrity, export/compiler parity, cancellation and output limits remain
owned by existing layers. Private service payloads are not public test fixtures.
