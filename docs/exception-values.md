# Phase 5 exception design

**Status: design and toolchain feasibility checked; compiler support is not implemented.**

The current IR v2 frontend rejects `ThrowStatement` and `TryStatement`; neither the semantic operation set nor lowered IR has exceptional control flow. The legacy IR's `Try`, `Throw`, and `ThrowNew` nodes are not consumed by the IR v2 pipeline.

## Backend constraint

The pinned tools are Wasmtime 46.0.3 and `wasm-tools` 1.252.0. A core module containing `tag`, `throw`, and `try_table` parses and validates with `wasm-tools`. Wasmtime 46.0.3 executes the caught-throw smoke module when run with `-W exceptions=y -W gc=y`.

Wasmtime 49.0.0 (released 2026-09-21) was also tested from its Linux x86_64 release binary. It executes the same caught-throw core module with default settings, and it runs a generated WASI 0.3 command component. Repeating `component new` with the exception-bearing program still fails in `wasm-tools` 1.252.0 with `unsupported section 13 in adapter`; upgrading only Wasmtime does not change the packaging result.

The current command packaging path cannot accept that program module: `wasm-tools component new ... --adapt porffor_program=...` fails with `unsupported section 13 in adapter` (the exception tag section). This is a `wasm-tools` adapter limitation in the pinned workflow, even though the runtime can execute the core module. A control module using multi-value function results packages through the same adapter successfully. Therefore the first compiler implementation should use explicit completion propagation and avoid emitting Wasm exception sections.

## Proposed IR contract

Represent a function outcome as a completion pair: an `i32` status (`0` normal, `1` thrown) and a `jsval` payload (the return value or thrown JS value). Internal function calls return both values. Lowered IR gains an `Invoke` terminator that calls a direct or closure target and branches to a normal successor carrying the result or an exceptional successor carrying the thrown value. An explicit `Throw` terminator carries its `jsval` to the active handler; with no local handler it returns a thrown completion from the function.

The frontend tracks the active catch target while building a `try` body. `throw expression` evaluates its expression once and exits through the current handler edge. `catch (identifier)` receives the thrown value as a block parameter. A call inside a protected region becomes `Invoke`, so a callee's thrown completion follows the exceptional edge; outside a protected region it propagates as a thrown function completion. The closure ABI follows the same completion convention.

The component entry wrapper remains `main: () -> ()`. It handles an uncaught completion at the program boundary using the runtime's uncaught-exception policy; internal functions use the completion ABI. This keeps completion details out of the component ABI and lets the component adapter continue packaging the module.

## Initial source boundary and verification

The first source slice is `throw expression` and `try { ... } catch (identifier) { ... }`, including throws crossing direct and closure calls. `finally`, async rejection, host exceptions, implicit runtime errors, and error-class formatting remain out of scope. Tests should cover caught local throws, normal completion through a try body, catch binding scope, direct and closure call propagation, nested handlers, and uncaught propagation at the command boundary across the interpreter, core Wasm, and component runtime.

Before relying on the completion ABI, add a pinned-toolchain regression test showing that its multi-value internal-call module still packages and runs as a component. Do not enable Wasm EH instructions in emitted programs unless the adapter limitation is resolved and covered by the same end-to-end checks.
