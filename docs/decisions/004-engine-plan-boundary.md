# Runtime-neutral k6 execution plan

Status: accepted architecture direction; implementation and native conformance
remain separate work. Owner: engine compiler/runtime. Date: 2026-11-07.

The compiler and k6 runtime need the same compiled plan types and deterministic
selection semantics. Copying selectors into generated scripts would create a
second implementation; importing the Node validation/generation adapter into k6
would couple incompatible runtimes.

Use `engines/k6/plan/` for pure plan types, selection and fixed result/error helpers.
Compiler and native runtime depend on its public entrypoint. It cannot import the
runtime, Node APIs, compiler values or arbitrary third-party packages. Move existing
pure implementations there; retain compiler exports as forwarding entrypoints when
they describe the current source API, not a legacy product compatibility layer.

Plan modules may import **types only** from the exact compiler-generated schema
type module, preserving the JSON Schema source of configuration vocabulary. Those
imports erase under verbatim-module TypeScript compilation. Values, mixed imports,
dynamic imports and Node type imports remain rejected. The gate also examines
type-import expressions and type reexports; it does not infer erasure from usage.
No handwritten duplicate DTOs or second schema generator are introduced.

Native modules may import k6 APIs and the plan/runtime modules. A build must still
prove that runtime bundles contain no Node modules and that native k6 accepts them.
This dependency rule is not evidence of runtime semantics or resource enforcement.
