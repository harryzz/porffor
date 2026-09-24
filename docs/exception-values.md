# Phase 5 exception design

**Status: design and toolchain feasibility checked; compiler support is not implemented.**

The current IR v2 frontend rejects `ThrowStatement` and `TryStatement`; neither the semantic operation set nor lowered IR has exceptional control flow. The legacy IR's `Try`, `Throw`, and `ThrowNew` nodes are not consumed by the IR v2 pipeline.

## Existing Porffor exception handling

Porffor does already implement JavaScript exceptions in its **production legacy pipeline** (`parser -> codegen -> legacy IR -> C renderer`). The parser builds `ThrowStatement` and `TryStatement` nodes; `codegen.js` lowers them to `Throw`, `ThrowNew` and `Try` IR nodes. `render.js` implements a per-execution-context try stack with C `setjmp`/`longjmp`: `porf_throw` stores the thrown `jsval` and jumps to the most recent handler, while the `Try` renderer runs either the protected body or catch body. The runtime also uses this mechanism for internal/runtime throws and coroutine rejection propagation. This is software-managed JS EH, not native Wasm EH.

The Phase 4/5 Wasm component work uses the **separate IR v2 pipeline** (`scripts/compile-component.mjs -> compiler/ir-v2 -> compiler/backends/wasm`). That frontend explicitly rejects `ThrowStatement` and `TryStatement`; the Wasm backend has no exception operations. Thus the adapter failure is a packaging constraint for any future native-EH Wasm module, while the immediate language-support gap is that the new Wasm pipeline does not yet reuse or port the production legacy exception implementation. The legacy `setjmp`/`longjmp` implementation cannot simply be emitted into Wasm as C, because this path directly emits core Wasm and has its own IR/backend.

## Backend constraint

The pinned tools are Wasmtime 49.0.0 and `wasm-tools` 1.259.0. A core module containing `tag`, `throw`, and `try_table` parses and validates with `wasm-tools`. Wasmtime 49.0.0 runs a caught-throw module by default and runs generated WASI 0.3 command components. It also runs a caught `i64` exception payload with WasmGC disabled (`-W exceptions=y -W gc=n`), so the exception mechanism does not inherently require WasmGC for Porffor's packed `jsval` payload.

## Minimal native-EH probe

`tests/fixtures/native-eh-cross-call.wat` declares a tag with one `i64` payload, throws `42` from a callee, and catches it in the exported caller using `try_table`. With the pinned tools:

```sh
.tools/phase4/wasm-tools-1.259.0-x86_64-linux/wasm-tools parse tests/fixtures/native-eh-cross-call.wat -o /tmp/native-eh-cross-call.wasm
.tools/phase4/wasm-tools-1.259.0-x86_64-linux/wasm-tools validate /tmp/native-eh-cross-call.wasm
.tools/phase4/wasmtime-v49.0.0-x86_64-linux/wasmtime run -W gc=n -W exceptions=y --invoke main /tmp/native-eh-cross-call.wasm
```

Validation succeeds and Wasmtime returns `42`. This proves the pinned engine runs the core EH instruction path with WasmGC disabled, including propagation across a call. It is a core-Wasm probe, not yet a Porffor-generated module or a component test.

The adapter-shaped fixture `tests/fixtures/native-eh-adapter.wat` has the command runtime's expected `main: () -> ()` export type. It parses and validates, but packaging it with the current runtime fails before producing a component: `failed to reduce input adapter module to its minimal size` / `unsupported section 13 in adapter`. This confirms the current failure is specific to packaging an EH-bearing program as the adapter. A separate direct-composition probe below succeeds without that adapter route.

The adapter pass failure is not a Wasmtime execution or general component-validation limitation. In [`wit-component`'s adapter GC pass](https://github.com/bytecodealliance/wasm-tools/blob/v1.259.0/crates/wit-component/src/gc.rs#L155-L161), the source explicitly says its in-memory module representation is incomplete and limited to adapter modules. The parser handles function, table, memory and global imports, but rejects tag imports explicitly ([`gc.rs`](https://github.com/bytecodealliance/wasm-tools/blob/v1.259.0/crates/wit-component/src/gc.rs#L236-L260)); tag section 13 has no parser arm and reaches the generic `unsupported section` branch ([`gc.rs`](https://github.com/bytecodealliance/wasm-tools/blob/v1.259.0/crates/wit-component/src/gc.rs#L317-L330)). Further gaps include a liveness visitor that ignores `tag_index`, an unimplemented `try_table` case, and an encoder with no tag-index map ([`gc.rs`](https://github.com/bytecodealliance/wasm-tools/blob/v1.259.0/crates/wit-component/src/gc.rs#L982-L992), [`gc.rs`](https://github.com/bytecodealliance/wasm-tools/blob/v1.259.0/crates/wit-component/src/gc.rs#L1024-L1053)). The adapter minimizer cannot currently preserve and remap exception tags and catch references. The direct-composition prototype bypasses this pass.

The current production prototype uses the adapter route: `component new` takes the Rust command runtime module and supplies the generated core program as its `porffor_program` adapter. See [package-command.mjs](../compiler/components/package-command.mjs) and [component-runtime/src/lib.rs](../component-runtime/src/lib.rs). The component-level command entry is `wasi:cli/run@0.3.0`'s async `run()` export from [command-world.wit](command-world.wit); the Rust command driver calls the core program's internal `main()`.

A direct-composition feasibility probe now exists in [probe-direct-component.mjs](../scripts/probe-direct-component.mjs). It componentizes an EH-bearing program core module from WIT metadata, plugs a WAT runtime-provider component into it, then plugs that program into a separate WASI command driver exporting `wasi:cli/run`. The final component validates and runs under Wasmtime 49; its final WIT exposes only `wasi:cli/run`, and the EH tag/`try_table` remain present in the embedded core module. This proves one no-adapter component topology, not the intended Porffor runtime architecture: the program and runtime provider are fixtures, and the provider only asserts the caught payload is 42. The intended architecture is to link the Rust runtime as an internal relocatable Wasm object into the compiler-generated core program, sharing its linear memory, and then package the linked program with a separate command driver. The first restricted compiler object target now links a scalar `print_number` call to a small Rust object; production runtime services, heap/data linking, and native EH are still unsupported.

## Interaction with Porffor's collector

Porffor's collector is separate from WasmGC: heap objects live in linear memory and roots live in an explicit shadow stack. Heap-using generated functions call `RootEnter`; the Wasm backend calls `RootLeave` only in the normal `Return` epilogue. Wasm exceptions can carry a packed `jsval` as an `i64`, but neither Wasmtime's exception machinery nor WasmGC traces the linear-memory object referenced by those bits.

This does not prevent exceptions, but EH unwinding across calls skips each unwound function's normal `RootLeave`. The shadow-stack top would remain at an unwound frame, retaining stale roots and eventually consuming root capacity. A generated `catch_all` cleanup/rethrow landing pad in every heap-using function could restore the root stack, but it must also root the thrown `jsval` before any allocating cleanup. Alternatively, explicit normal/thrown completion returns can run through the existing root-frame cleanup path. A same-function catch edge does not unwind a function frame; the cleanup issue arises when exceptions propagate across calls.

## Native EH implementation direction

The working direction is native Wasm EH, rather than representing every function result as an explicit normal/thrown completion pair. Use a typed tag carrying Porffor's packed `jsval` (`i64`), lower throws to `throw`, and lower catch regions to `try_table` handlers. The core probe establishes that this payload and call-unwind path run in Wasmtime 49 with WasmGC disabled. The compiler frontend, semantic IR, lowered IR, Wasm tag/type/index sections, and exception instructions still need implementation.

The frontend must track active catch targets and preserve JS catch binding behavior. A throw crossing calls should unwind natively to the matching handler. Heap-using functions also need EH cleanup landing pads: restore each Porffor shadow-stack frame, keep the thrown `jsval` rooted during cleanup, then rethrow. Root cleanup is required for correctness with Porffor's collector.

The component driver continues to expose `wasi:cli/run`; the generated core program's `main` is an internal function called by that driver. Runtime functions remain internal component links, not public WIT host interfaces.

## Initial source boundary and verification

The first source slice is `throw expression` and `try { ... } catch (identifier) { ... }`, including throws crossing direct and closure calls. `finally`, async rejection, host exceptions, implicit runtime errors, and error-class formatting remain out of scope. Tests should cover caught local throws, normal completion through a try body, catch binding scope, direct and closure call propagation, nested handlers, and uncaught propagation at the command boundary across the interpreter, core Wasm, and component runtime.

Before enabling native EH in compiler output, extend object linking to the real Rust runtime and shared heap memory, split the command driver from runtime implementation, componentize the linked core program without `adapt`, test EH root cleanup through repeated collection, and run source-level catch tests in the command component. Do not restore the adapter-based packaging path for EH-bearing program modules.
