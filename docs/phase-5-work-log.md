# Phase 5 work log — dynamic runtime, increment 1

Date: 2026-09-23. User requested Phase 5 after command-component packaging. This work begins the brief's incremental dynamic-runtime migration with boxed primitives; it does not mark the whole phase complete.

## Step 1 — inspect the representation and scope

Reviewed the project brief, existing IR/backend and command wrapper, upstream `porf_pack`/`porf_unpack`, type IDs and string layout, plus collector/root and native coroutine references. Existing production execution often uses split values, while stored values use NaN boxing. The new scalar ABI preserves the packed layout, with canonical NaNs and no native pointers.

Selected a first executable boundary: number, boolean, null and undefined values through locals, CFG joins and direct calls. Heap-bearing values stay unsupported until allocation, effects, memory ownership and root protocols are in place. Documented that plan in [primitive-values.md](primitive-values.md). Consulted the ECMAScript conversion/equality references linked there.

## Step 2 — explicit source mode and IR lowering

Added `--primitives` to the IR dump, core compiler and component compiler commands. Existing numeric mode stays the default. Added dynamic semantic construction for null/undefined, uninitialized let, bare/implicit returns and built-in primitive identifiers with lexical binding checks.

Added a separate `lowerPrimitives` pass: semantic values become jsval, with explicit checked boxing, conversion, truthiness, strict equality and printing operations. Numeric temporaries retain existing scalar operations and integer conversions. Mixed branch/loop values and polymorphic direct calls no longer require monomorphic number/boolean inference. Postfix updates explicitly convert the old primitive before returning it.

## Step 3 — emit value helpers directly in Wasm

Factored binary encoding helpers into a shared backend module, mapped jsval to i64, and emitted private helpers for boxing, primitive coercion, equality, truthiness and print dispatch. Boxed Number NaNs cannot collide with tagged values. Unsupported tags/malformed payloads trap in primitive consumers. The argument API uses checked number unboxing, preserving its numeric-only boundary.

Hosts gained only fixed null/undefined print appenders; they never interpret jsval or evaluate primitive operations. Rebuilt the existing WASI wrapper without changing its WIT contract. Added the runnable mixed-value example and generated `/tmp/phase5-values.wasm` plus IR dumps in `/tmp/phase5-values-ir/`.

## Step 4 — validation and differential findings

The existing 206 unit/backend/argument tests passed after backend integration. The first 70 primitive tests and all 54 boxed-component tests passed. Added three protected-global negative cases, for 73 primitive tests total.

The first 20-case C differential run had seven failing comparisons: two were NaN printf spelling differences, three were real stdout/value mismatches, and two shadowing cases needed review of Script versus CommonJS scope. Changed those fixtures to valid block-scoped shadowing and made the Node oracle use `vm.Script`. The retained C backend still rejected those valid scopes, confirming two additional reference discrepancies. Added explicit frontend checks for protected top-level global declarations.

Recorded five new C discrepancies with exact expectations: null returned through mixed/polymorphic calls prints blank; update expressions mishandle nonnumeric values; valid block shadowing of undefined and NaN/Infinity is rejected. All are mandatory named assertions, not skips. Reproduced them separately with unchanged production sources and Clang 19 at `-O0`; source, C, native binaries, stdout, stderr and statuses are saved under `/tmp/phase5-c-regressions/`.

The corrected primitive differential suite passed all 20 tests: Node/IR/Wasm agree on all; C agrees on 15 and matches its five explicitly recorded discrepancies. The original numeric differential tests also now execute boxed lowering while retaining the original numeric path and its previously recorded C evaluation-order regression.

## Step 5 — integrate and verify

Added primitive suites to the existing native and component baseline commands, so the foundation CI jobs include them. Regenerated the coupling index. The complete component baseline passed after the final fixture changes; the full native baseline results follow below after completion.

AI disclosure: OpenAI Codex authored and tested this increment. No remote issue, PR, message or push was submitted.

## Increment 1 — final verification

Both baseline commands exited **0**:

- Native/IR baseline: `/tmp/js2wasi-baseline-KdNf6G/`.
- Component baseline: `/tmp/js2wasi-component-baseline-HdGdmQ/`.

Logs are temporary local artifacts; the scripts reproduce every check.

| Check | Result |
| --- | --- |
| Original native compiler build | Passed |
| 11 upstream parity cases plus self-compilation | Passed |
| Pinned Test262 harness | Expected baseline retained: 107/116 |
| Native arithmetic/loop smoke | Passed: 42 and 45 |
| Existing and new IR/backend/argument/primitive unit suites | 279 passed |
| Numeric Node / C / IR / Wasm suite, now also checking boxed lowering | 33 passed |
| New primitive Node / C / IR / Wasm suite | 20 passed, including five exact C discrepancy assertions |
| Original component command suite | 42 passed |
| New boxed component suite | 54 passed |
| Total distinct tests | **428 passed, zero failures/skips** |
| Component baseline alone | 107 passed (11 repeated argument tests plus 96 component tests) |
| Locked runtime rebuild, module/CLI checks and WIT snapshot | Passed |
| Coupling inventory check | Passed |

The final primitive example emitted `/tmp/phase5-values-final.component.wasm` (120519 bytes) and printed `null`, `42`, `3`, `undefined`, `false` under pinned Wasmtime. The standalone core module and review dumps were also validated. These artifacts are reproducible using the documented commands; sizes describe this local build.

Production compiler, native runtime, builtins, selfhost sources and original release workflow remain unchanged from upstream `8f015414`. Changes remain local and uncommitted, with no push or remote CI run.

**Increment 1 is complete; Phase 5 remains in progress.** The next increment is strings: settle heap-memory ownership and allocation/rooting contracts, then migrate literals, concatenation, length/equality and output with differential and allocation-pressure tests. Arrays, objects, closures, indirect calls, exceptions, tracing GC and additional built-ins remain separate Phase 5 migrations. No claim of a working JS heap/collector or general dynamic JavaScript is made by this primitive milestone.

## Increment 2 — strings and bounded allocation (2026-09-23)

Continued the next requested step with string literals, concatenation, length, strict equality, truthiness and printing. The [string contract](string-values.md) specifies the source subset, memory ownership, layout, runtime imports and limitations.

1. Chose a separate 4 MiB arena for each instance. All allocations remain live until instance destruction; exhaustion traps. This establishes safe reference lifetime without pretending a collector or explicit root stack exists. The component wrapper owns a stable allocation disjoint from its other memory; emitted Wasm owns the object layout and allocation cursor.
2. Added semantic/lowered string operations and conservative interprocedural type propagation. Unsupported possible string numeric coercions/order are rejected; `.length` needs string evidence. Preserved numeric-only compilation and explicit `--primitives` selection.
3. Emitted string allocation, literals, concatenation, content equality, truthiness and print dispatch directly as Wasm. Added typed host memory, UTF-16 output and number-formatting capabilities. Kept WIT unchanged and the Rust wrapper independent of source/IR.
4. Added 39 core/IR tests, 22 differential fixtures and 27 component tests. Covered loops, recursion, instance isolation, literal caching, UTF-16/lone surrogates/NUL, invalid pointers and headers, initialization retries, runtime boundaries and heap exhaustion. Fixed test-source escaping so UTF-8 fixture files retain literal surrogate escapes.
5. Recorded six exact legacy C discrepancies: exponent formatting, left-operand evaluation timing, UTF-16 surrogate-pair output, lone-surrogate output, embedded NUL output and Unicode output. Node and the new execution paths must match correct expected values; the old C outputs are separately asserted. No cases are skipped.
6. Added the new suites to both baseline scripts and regenerated the coupling source index. The existing CI workflow consumes these scripts. Added a runnable string example and updated the primitive documentation to point to the extended contract.

AI disclosure: OpenAI Codex authored and tested this increment. Work remains local; no remote PR, message or push was submitted.

### Increment 2 — final verification

Both complete baseline commands exited **0**:

- `node scripts/baseline.mjs`: `/tmp/js2wasi-baseline-Qhfn6o/`.
- `node scripts/baseline-component.mjs`: `/tmp/js2wasi-component-baseline-q2rO90/`.

| Check | Result |
| --- | --- |
| Original native build and 11 parity cases plus self-compilation | Passed |
| Pinned Test262 harness | Expected 107/116 baseline retained |
| Native arithmetic/loop smoke | Passed |
| IR/backend/argument/primitive/string unit suites | 317 passed |
| Numeric differential suite | 33 passed |
| Primitive differential suite | 20 passed |
| String differential suite | 22 passed, including six exact legacy C discrepancy assertions |
| Original, primitive and string component suites | 42 + 54 + 27 passed |
| Total distinct tests | **515 passed, zero failures/skips** |
| Component baseline alone | 134 passed, including 11 repeated argument tests |
| Runtime rebuild, WIT snapshot, coupling inventory and syntax checks | Passed |

The previous string-rejection unit case was replaced by positive string coverage. Test262's nine existing nonpasses are preserved separately from the 515 foundation tests; no general Test262 conformance claim is made.

The documented example CLI produced `/tmp/phase5-strings-final.wasm` (3223 bytes) and `/tmp/phase5-strings-final.component.wasm` (126153 bytes). Node and pinned Wasmtime both printed `Hello, WASI`, `11`, `value=42`, `😀`, `true`. These are temporary local artifacts; documented commands reproduce them.

Production compiler, native runtime, builtins, selfhost sources and original release workflow remain unchanged from upstream `8f015414`. Changes remain local and uncommitted; no remote CI run or push occurred.

**Increment 2 is complete; Phase 5 remains in progress.** The next heap step is explicit roots and tracing collection, with repeated-collection tests that preserve live references through calls, recursion and CFG edges. Only after that may this allocator reclaim storage. Arrays/typed arrays, objects/properties, closures, indirect calls, exceptions and additional built-ins remain outstanding migrations.

## Increment 3 — explicit roots and string collection (2026-09-24)

Replaced the retain-everything string allocator with a nonmoving mark-sweep collector while preserving the jsval string pointer and visible UTF-16 layout.

1. Reserved a bounded shadow-stack region inside each program arena. Every emitted string-bearing function now creates a frame for its jsval parameters and locals, initializes every slot, updates slots after instruction and parallel-edge assignments, and releases the frame on normal return. Allocating helpers temporarily push intermediate conversion and concatenation results. Cached literal pointers are separate permanent roots.
2. Added an eight-byte collector header before each string payload. Allocation searches reusable blocks before extending the bump region. On pressure it marks shadow-stack and literal roots, sweeps unreachable strings, coalesces adjacent free blocks, splits oversized free blocks, then retries. Objects never move, so existing pointers remain stable.
3. Added configurable arena sizing to the internal Wasm emitter for pressure tests. Three new core tests force repeated collections in small arenas and verify live strings across calls, recursion, returns, loops and parallel CFG edges. A packaged-component test allocates beyond the default 4 MiB bump capacity and verifies that its retained string survives collection.
4. Kept unrecoverable live-set exhaustion as a checked core trap. A trapped function cannot run its normal shadow-frame epilogue; standalone callers that catch a Wasm trap and reuse the instance may retain abandoned slots. Command traps terminate their instance. This limitation is explicit in the string contract.
5. The collector currently traces strings as leaf objects. Arrays, objects and closures will require type-directed child traversal before their heap layouts can use this collector.

AI disclosure: OpenAI Codex authored and tested this increment. Work remains local; no remote PR, message or push was submitted.

### Increment 3 — final verification

Both complete baseline commands exited **0**:

- `node scripts/baseline.mjs`: `/tmp/js2wasi-baseline-cU0Vzb/`.
- `node scripts/baseline-component.mjs`: `/tmp/js2wasi-component-baseline-Im5PWm/`.

| Check | Result |
| --- | --- |
| Original native build and 11 parity cases plus self-compilation | Passed |
| Pinned Test262 harness | Expected 107/116 baseline retained |
| Native arithmetic/loop smoke | Passed |
| IR/backend/argument/primitive/string/collector unit suites | 320 passed |
| Numeric, primitive and string differential suites | 33 + 20 + 22 passed |
| Original, primitive and string component suites | 42 + 54 + 28 passed |
| Total distinct foundation tests | **519 passed, zero failures/skips** |
| Component baseline alone | 135 passed, including 11 repeated argument tests |
| Runtime rebuild, WIT snapshot, coupling inventory, syntax and diff checks | Passed |

The example commands produced `/tmp/phase5-gc-final.wasm` (4616 bytes) and `/tmp/phase5-gc-final.component.wasm` (127546 bytes). Node and pinned Wasmtime both printed `Hello, WASI`, `11`, `value=42`, `😀`, `true`. These temporary local artifacts are reproducible with the documented commands.

Production compiler, native runtime, builtins, selfhost sources and the original release workflow remain unchanged from upstream `8f015414`. Changes remain local and uncommitted; no remote CI run or push occurred.

**Increment 3 is complete; Phase 5 remains in progress.** The next migration is arrays and typed arrays. It needs new heap layouts, type-directed marking of child references, indexed access and mutation IR, and differential/component pressure tests. Objects/properties, closures, indirect calls, exceptions and additional built-ins remain later steps.

## Increment 4 — arrays and Uint8Array (2026-09-24)

Added the first indexed heap containers to the explicit dynamic path. The [array contract](array-values.md) records the supported source semantics, layouts, collector behavior and deliberate boundaries.

1. Extended syntax and semantic IR with dense array literals, `new Uint8Array(length)`, generic `.length`, indexed reads and indexed assignment. Assignment preserves object/index/right-hand evaluation order. Numeric mode retains its original array rejection.
2. Added variadic semantic validation for literal elements and lowered literals into allocation plus ordered element stores. Array/typed-array values use packed jsval tags compatible with upstream internal IDs. A conservative closed-program analysis propagates container and element types through calls and CFG edges, rejecting unsupported coercion, printing, identity equality and ambiguous nested access.
3. Added direct Wasm helpers for fixed-length Array allocation, zeroed Uint8Array allocation, checked index conversion, reads, writes, length and truthiness. Ordinary out-of-range reads and typed-array out-of-range reads return undefined. Uint8Array writes outside bounds are ignored. Ordinary array growth is deferred to the property model and traps at the runtime boundary.
4. Extended marking by heap tag. Arrays are marked before recursively tracing packed elements, which handles shared children, post-allocation mutation and cycles. Strings and Uint8Array remain leaves. Allocation and tracing stay in emitted Wasm; the Node host, Rust wrapper and WIT are unchanged.
5. Added 18 core/IR tests, 10 Node/C/Wasm differential fixtures and 12 component tests. Pressure cases preserve references stored and mutated inside arrays, terminate on cycles, and collect beyond the default component arena's bump capacity. The legacy C backend agrees on nine differential fixtures; its typed-array out-of-bounds case terminates with `SIGSEGV`, asserted by exact signal.

AI disclosure: OpenAI Codex authored and tested this increment. Work remains local; no remote PR, message or push was submitted.

### Increment 4 — final verification

Both complete baseline commands exited **0**:

- `node scripts/baseline.mjs`: `/tmp/js2wasi-baseline-Gj040c/`.
- `node scripts/baseline-component.mjs`: `/tmp/js2wasi-component-baseline-6ZO9Ho/`.

| Check | Result |
| --- | --- |
| Original native build and 11 parity cases plus self-compilation | Passed |
| Pinned Test262 harness | Expected 107/116 baseline retained |
| Native arithmetic/loop smoke | Passed |
| IR/backend/argument/primitive/string/array unit suites | 338 passed |
| Numeric, primitive, string and array differential suites | 33 + 20 + 22 + 10 passed |
| Original, primitive, string and array component suites | 42 + 54 + 28 + 12 passed |
| Total distinct foundation tests | **559 passed, zero failures/skips** |
| Component baseline alone | 147 passed, including 11 repeated argument tests |
| Runtime rebuild, WIT snapshot, coupling inventory, syntax and diff checks | Passed |

The documented example produced `/tmp/phase5-arrays.wasm` (4822 bytes) and `/tmp/phase5-arrays.component.wasm` (127268 bytes). Node and pinned Wasmtime both printed `3`, `updated`, `two`, `4`, `1`, `255`. These temporary local artifacts are reproducible using the documented commands.

Production compiler, native runtime, builtins, selfhost sources and the original release workflow remain unchanged from upstream `8f015414`. Changes remain local and uncommitted; no remote CI run or push occurred.

**Increment 4 is complete; Phase 5 remains in progress.** The next migration is ordinary object allocation and fixed property access. It must define property layouts, mutation and type-directed tracing before expanding to dynamic keys/prototypes. Closures, indirect calls, exceptions and additional built-ins remain later steps.

## Increment 5 — ordinary objects and fixed properties (2026-09-24)

Added ordinary object literals and fixed-name properties to the explicit dynamic path. The [object contract](object-values.md) records the supported syntax, inline layout, collector behavior, and deliberate boundaries.

1. Extended semantic syntax and IR with ordinary data-property literals, fixed-name reads, and fixed-name assignment. Identifier, string-literal, shorthand, and duplicate names are supported; dynamic keys, methods, accessors, spread, and computed definitions are rejected.
2. Assigned deterministic module-local integer identifiers to property names, reserving identifier 1 for `length`. Lowering allocates an object and stores literal values in source order. Strings, arrays, and Uint8Array dispatch reserved `length` to their existing length helper, while ordinary objects treat it as a data property.
3. Added a checked inline object layout with a live count, capacity, and 16-byte key/value slots. Objects reserve at least eight slots; larger literals reserve their entry count. Existing fields update in place, new fields append while capacity remains, missing reads return undefined, and capacity exhaustion traps.
4. Extended field-based closed-program facts and heap operations through calls and CFG edges. Supported nested fixed fields remain usable. Printing, identity comparison, coercion, ambiguous receivers, and other unimplemented object behavior fail before Wasm emission.
5. Extended marking to recursively trace every live object field after marking the object itself. Self-cycles terminate, and fields retain nested strings and objects across repeated collection. Null remains distinguishable despite sharing the packed object tag because its pointer payload is zero.
6. Added 18 core/IR tests, 10 Node/C/Wasm differential fixtures, and 12 component tests. The retained C backend agrees on every supported fixture; no new discrepancy annotation was needed. Added the new suites to both baseline scripts and a runnable fixed-property example.

AI disclosure: OpenAI Codex authored and tested this increment. Work remains local; no remote PR, message, or push was submitted.

### Increment 5 — verification

The complete component baseline exited **0**:

- `node scripts/baseline-component.mjs`: `/tmp/js2wasi-component-baseline-ZYtjDt/`.

The native baseline's deterministic stages also passed, but no post-fix invocation completed as one process because the pinned selfhost Test262 harness became timing-sensitive on the local machine. The first invocation, `/tmp/js2wasi-baseline-8HlObo/`, passed the original build, parity, the expected 107/116 Test262 result, and native smoke before finding one stale assertion: fixed computed string `length` was still expected to be rejected. That assertion was replaced with a positive regression test. The combined 356-test unit command then passed. Later complete invocations rebuilt and passed parity but reported one and three Test262 timeouts respectively, producing 106/116 and 105/116 before the script stopped. Production compiler and selfhost sources were unchanged, and the baseline's exact 107 expectation was not weakened.

The remaining native stages were rerun directly with the same pinned Node and Clang tools after the assertion fix:

| Check | Result |
| --- | --- |
| Original native build and 11 parity cases plus self-compilation | Passed on every complete attempt |
| Pinned Test262 harness | Expected 107/116 passed once; later reruns had transient timeouts |
| Native arithmetic/loop smoke | Passed: 42 and 45 |
| IR/backend/argument/primitive/string/array/object unit suites | 356 passed |
| Numeric, primitive, string, array, and object differential suites | 33 + 20 + 22 + 10 + 10 passed |
| Original, primitive, string, array, and object component suites | 42 + 54 + 28 + 12 + 12 passed |
| Total distinct foundation tests | **599 passed, zero deterministic failures/skips** |
| Component baseline alone | 159 passed, including 11 repeated argument tests |
| Locked runtime rebuild, WIT snapshot, coupling inventory, syntax, and diff checks | Passed |

The documented example produced `/tmp/phase5-objects.wasm` (5126 bytes) and `/tmp/phase5-objects.component.wasm` (128062 bytes). Both printed `Ada`, `3`, `Sofia`, and `undefined`. These temporary local artifacts are reproducible using the documented commands.

Production compiler, native runtime, builtins, selfhost sources, and the original release workflow remain unchanged from upstream `8f015414`. Changes remain local and uncommitted; no remote CI run or push occurred.

**Increment 5 is complete; Phase 5 remains in progress.** Fixed-name objects now share the collector with strings and arrays. The next object-model increment is dynamic property keys and expandable storage, followed by prototypes and callable closures/indirect calls; exceptions and additional built-ins remain separate migrations.

## Increment 6 — dynamic string property keys (2026-09-24)

Added runtime string-key reads and writes for ordinary objects. Fixed dot and literal-bracket properties now lower through the same string-key representation, allowing both forms to address one field. Computed numeric accesses remain indexed array/typed-array operations when conservative facts prove a numeric key and container receiver. Dynamic keys on objects must be strings; capacity remains bounded by the inline object allocation and is the next step.

1. Added explicit semantic operations for computed property reads and writes. The frontend evaluates receiver, key, and assigned value in source order. The heap analysis routes proven numeric container access back to indexed IR and rejects ambiguous receiver/key combinations.
2. Changed lowered property intrinsics to take boxed string keys. Fixed property names become pooled UTF-16 literals, and dynamic key values flow directly to the runtime helper.
3. Changed object slots to hold a traced jsval string key and a jsval value. Reads and writes compare key contents, preserving duplicate, update, missing-field, and dynamic lookup behavior. The collector traces both keys and values.
4. Kept each object block stable and added linked eight-property overflow pages. New pages use the same checked object layout and are reachable through a traced internal object reference. Existing aliases retain the original object pointer, and collection can reclaim pages only after the owner becomes unreachable.

AI disclosure: OpenAI Codex authored this increment. Work remains local; no remote PR, message, or push was submitted.

## Increment 10 — exception IR design and component feasibility (2026-09-24, in progress)

Confirmed IR v2 does not implement `throw` or `try/catch`: `ThrowStatement` is rejected in the frontend, and there are no exceptional operations or edges in semantic/lowered IR. The legacy IR has similarly named nodes, but they are not used by IR v2.

Inspected the production legacy path as well: it does implement JS exceptions in software. `codegen.js` lowers throw/try to legacy IR nodes, and `render.js` uses a `setjmp`/`longjmp` handler stack carrying `jsval`. This implementation is separate from the direct IR v2 Wasm backend, so it does not provide native Wasm EH or automatically transfer to the component output. Documented the distinction in [exception-values.md](exception-values.md).

Added a minimal native-EH core-Wasm probe: `tests/fixtures/native-eh-cross-call.wat` throws an `i64` payload from a callee, catches it in the caller with `try_table`, and returns it. With pinned `wasm-tools` 1.259.0 it parses/validates; pinned Wasmtime 49.0.0 with `-W gc=n -W exceptions=y` returns `42`. An adapter-signature variant (`native-eh-adapter.wat`) also parses/validates but packaging it with the actual built Wasip3 runtime fails at adapter minimization with `unsupported section 13 in adapter`. This confirms direct core execution is viable while the current adapter route is blocked for EH modules.

Prototyped the no-adapter route end to end in [probe-direct-component.mjs](../scripts/probe-direct-component.mjs): the EH-bearing program core module is componentized directly from WIT metadata; a separate runtime-provider component implements an internal payload-check function; a separate Rust command driver imports the program and exports `wasi:cli/run`; WAC 0.11.0 plugs the components together. Wasmtime 49 runs the resulting component successfully, `wasm-tools validate` passes, `component wit` shows only the public `wasi:cli/run` export, and printing the component confirms the EH tag and `try_table` remain embedded. This is only a topology proof: the provider is a WAT fixture, not Porffor's real Rust runtime, and the program is a hand-written EH fixture, not compiler output. The actual runtime must be split/reworked and the compiler must emit the metadata and EH operations before production uses this route.

Probed Wasmtime 46.0.3 and `wasm-tools` 1.252.0. Core Wasm exception tags and `try_table` validate, and Wasmtime 46 runs a caught-throw module with `exceptions` and `gc` enabled. The component adapter rejects an exception-bearing program with `unsupported section 13 in adapter`. A control module using multi-value function results packages successfully.

Then downloaded the latest Wasmtime release, 49.0.0 (Linux x86_64). Its default configuration runs the caught-throw core module and a generated WASI 0.3 command component that prints `42`. The exception-bearing adapter probe still fails in `wasm-tools` 1.252.0. This only rules out the current adapter-based packaging route; it does not establish a limitation for direct component generation. The toolchain is now pinned to Wasmtime 49.0.0; details and the exception IR design are in [exception-values.md](exception-values.md).

Updated the reproducible pins to Wasmtime 49.0.0 and `wasm-tools` 1.259.0, installed both under `.tools/phase4`, and removed the cached Wasmtime 46.0.3 and `wasm-tools` 1.252.0 directories. The exception adapter probe gives the same result under `wasm-tools` 1.259.0. All 167 component tests pass serially with the new pair. A first concurrent run timed out in three heap-pressure cases; each passes serially, including the GC-heavy array, object, and string cases.

Inspected the `wasm-tools` 1.259.0 source for the adapter error. `wit-component`'s adapter GC pass documents that its module representation is intentionally incomplete; its parser rejects tag imports and has no arm for tag section 13, so that section reaches the generic unsupported-section path. This identifies the specific limitation: the pass cannot track/liveness-trim/re-encode Wasm tags and their references. The current adapter workflow is a project packaging choice because the compiler emits a core module and plugs it into the separately built command runtime. It does not establish that direct component generation/composition would reject EH; that route needs a separate prototype.

Further source inspection found more adapter GC gaps beyond section parsing: the operator liveness visitor ignores tag indices and marks `try_table` as unimplemented, and the encoder has no tag-index remapping table. So EH support in this path needs a complete tag-aware liveness/re-encoding change, not merely a new section parser arm.

Checked interaction with Porffor's manual collector: Wasmtime 49 runs a caught `i64` exception payload with WasmGC disabled, but the compiler's linear-memory shadow stack is not unwound automatically. EH propagation across calls would skip generated `RootLeave` epilogues, so native Wasm EH would need cleanup/rethrow landing pads that also root the thrown `jsval`. Completion results would instead use the existing normal frame cleanup path.

This increment is still in progress: exception lowering, backend behavior, differential tests, and component tests have not yet been implemented.

## Increment 10 — direct-component compiler ABI check (2026-09-24)

Before implementing native EH in the compiler, checked whether the current IR v2 Wasm backend's *real generated core module* can enter the direct-component route. Compiled `console.log(42);` directly with `emitCoreWasm(..., { target: 'host' })` and inspected it using the pinned wasm-tools 1.259.0. Its imports are raw core names `("porffor", "print_number")` and its entry export is `"main"`. Embedding the current internal WIT interface (`porffor:internal/runtime@0.1.0`, `print-number`) and asking `component new` to encode the module fails: `failed to resolve import porffor::print_number` / `module requires an import interface named porffor`.

Generated the expected component ABI core names from the same WIT using `wasm-tools component embed --dummy -t`: wasm-tools 1.259.0 uses `cm32p2|porffor:internal/porffor@0.1` as the imported core module name and `print-number` as the import name, plus `cm32p2||main` for the lifted entry export. Therefore the hand-written direct-component probe proves WAC composition and EH preservation, but it does **not** prove the current compiler output can be packaged directly. This is an independent integration gap, before runtime splitting or exception lowering.

Implemented the first part of that next step. The Wasm backend now has an opt-in `component-core` target that emits the wasm-tools 1.259.0 `cm32p2` import/export names and exposes only the command `main`; existing `host` and `command-adapter` targets keep their prior naming and export behavior. Added [command-program.wit](../compiler/components/command-program.wit) to define the internal runtime ABI and [direct-component-abi.test.mjs](../tests/direct-component-abi.test.mjs), which compiles a real IR v2 numeric/boolean source, embeds WIT metadata, creates and validates a component, and checks the resulting internal runtime import and `main` export. The test passes locally. No GitHub CI was run.

This closes only the compiler-to-component naming mismatch for the tested numeric/boolean calls. The generated program component still imports `porffor:internal/runtime`; it is not yet linked to the real Rust implementation or the WASI command driver. The WIT ABI also needs checking against every dynamic-runtime intrinsic and its memory ownership before string/object programs can use it. Next step: compose this actual compiler-generated program component with the real Rust runtime and command driver, separating internal runtime exports from public WASI interfaces. Once that composition works without the adapter and shared-memory/data ownership is resolved, proceed with native EH IR and code generation. Production `compile-component.mjs` still uses the adapter path; this new target is opt-in and not wired into it.

## Increment 10 — Rust runtime object-link feasibility (2026-09-24)

Corrected the integration target to match the intended architecture: Porffor's Rust runtime is an internal implementation linked into the generated core program, while the final component's public WIT surface is only `wasi:cli/run`. An internal `porffor:internal/runtime` WIT component import/provider is useful as a packaging topology experiment, but it is not the planned runtime link and does not by itself provide shared linear memory.

Inspected the built Rust runtime module. `component-runtime/src/lib.rs` currently combines command-driver logic (`wasip3::...::export!(Command)`) with runtime functions (`print_number`, heap services, argument services); its generated core module imports `porffor_program::main` and exports the service functions. Direct `wasm-tools component new` fails because that raw `porffor_program` import is not described by its embedded WASI command world. The current `component new --adapt` packaging supplies this missing program binding through the adapter route.

Tested the object linker independently with a tiny `#![no_std]` Rust runtime object and a Wasm C program object. `rustc --target wasm32-unknown-unknown --crate-type=staticlib --emit=obj` emitted a runtime object; Clang emitted the caller object; `wasm-ld` 21.0.0 linked them; pinned Wasmtime 49 invoked the linked entry and returned `42`. Thus Rust-object + program-object linking works as a toolchain pattern. However, `wasm-ld` rejects the actual compiler-generated core module as a linker input: `not a relocatable wasm file`. The backend currently writes a final Wasm binary with fixed function indices and no linking/relocation sections. In addition, dynamic string code imports a `memory` and expects `string_heap_base()` to refer to that same memory; linking service functions across separate component instances would not establish that identity.

Therefore the previous `component-core` WIT ABI target remains an opt-in compiler/component experiment, not the Rust runtime architecture. Do not wire it into production packaging or claim it links the runtime. Added a deliberately narrow `object` target to the Wasm backend. It writes the WebAssembly `linking` symbol table and `reloc.CODE` function-index relocations required by `wasm-ld`, and emits padded function-index operands for runtime imports, direct compiler calls, and generated primitive helpers. The current boundary supports scalar/primitive operations plus number/boolean/null/undefined print services; heap memory, data, constructors, and EH are not supported.

Expanded object linking to direct calls between compiler-defined functions and calls from generated primitive helpers. The object regression now compiles a dynamic `twice(x)` function, uses `ValueToNumber`/`ValueBoxNumber`/`PrintValue` backend helpers, resolves their runtime print calls against Rust definitions, and has the Rust test entry call the generated `main`. The final core module has no unresolved imports, validates with wasm-tools, and pinned Wasmtime returns `42`.

This still does not link Porffor's production runtime, model shared heap memory/data, or componentize the linked program. Next step: support the shared memory/global/data symbols used by strings and the collector. After those link tests pass, split production Rust runtime services from the WASI driver and emit only the public command component boundary. Native EH follows once runtime linking and memory ownership work for generated code. `direct-component-abi`, `runtime-object-link`, and `wasm-backend` pass (48 total); `git diff --check` passes. No GitHub CI was run.

Extended the object-link slice to exercise string literals and the shared memory contract. Object output now imports `env.__linear_memory`, emits relocatable references to the generated mutable heap globals, and allows `ValueString` construction. The Rust test runtime defines the shared memory provider and `print_string`; the linked program prints a number and `"Hello"`, and the Rust entry verifies both by returning `47` (42 plus the observed five UTF-16 code units).

The first string-link attempt exposed a relocation-offset bug in rooted instructions: the code generator calculated the `RootSet` relocation before accounting for the pending `local.set` bytes emitted immediately before it. The relocation landed inside following instructions, producing invalid Wasm. The offset now includes those bytes. With that fix, `runtime-object-link` and `direct-component-abi` pass, `wasm-backend` passes all 46 tests, and `git diff --check` passes. This proves one shared-memory string path, not complete linking of the production heap/collector or data segments. Next: audit and support remaining runtime global/data and heap allocator dependencies, then link the real runtime object and separate the WASI command driver for final component generation. No GitHub CI was run.

## Increment 11 — production runtime static archive link (2026-09-24)

Audited the built production runtime module: it defines its own memory, stack pointer and allocator/table state; imports `porffor_program.main`; exports the runtime service functions; and carries substantial component command/WASI glue. Its final Wasip3 module is not itself a relocatable input, so linking that binary directly is the wrong boundary.

Added a `staticlib` crate artifact alongside the existing `cdylib`. The Wasip3 target retains the named `porffor_program` import needed by the current component route. The bare `wasm32-unknown-unknown` build leaves `main` as an ordinary undefined symbol for the static linker. Built this production crate archive and linked it against actual object output for a dynamic program that prints a number and a string. `wasm-ld` resolved the runtime functions, linked the program and runtime into one memory, and the resulting core module validated and ran under pinned Wasmtime 49.0.0. The archive’s unused WASI command glue was garbage-collected, leaving no core imports.

Added [runtime-production-object-link.test.mjs](../tests/runtime-production-object-link.test.mjs) to reproduce this with the repository runtime and pinned Rust toolchain. The production Wasip3 rebuild could not be rechecked here because Rust 1.95.0 has no `wasm32-wasip3` standard library installed in this environment; the earlier built artifact remains available. The three focused direct-component/object-link tests pass, as does `git diff --check`.

This closes the first actual compiler-object plus production-Rust-runtime link, but it did not yet produce a command component. A follow-up probe forced the Rust command entrypoint into the static link. It exposed a state-ownership issue in the earlier WAC topology: the program’s Rust runtime buffered output in the program component instance, while the separate command driver flushed a different instance’s buffer. The final design must statically link the driver, runtime, and program into the same core module.

## Rust toolchain update check (2026-09-24)

The environment now has stable Rust 1.98.1 and nightly 1.100.0. There is no prebuilt `wasm32-wasip3` std for these installations. Nightly `-Z build-std` compiled core/std for that target, but linking failed because its Wasip3 sysroot lacks `crt1-reactor.o` and `libc`. This target-specific route is unnecessary for the intended Rust API usage: the `wasip3` crate documents use with `wasm32-wasip2`, which is installed. The production command crate initially failed on that target because its raw `porffor_program::main` import was not declared in WIT.

Updated the component-target driver to declare `porffor:internal/api.main` with `wit-bindgen` for the existing component/adaptation route on `wasm32-wasip2` (or a future native p3 target). The legacy bare `wasm32-unknown-unknown` staticlib build still uses the `porffor_program` core import, while the `static-link` feature switches the entry to a plain symbol for wasm-ld. Added the direct `wit-bindgen 0.60.0` macro dependency and locked its generator dependencies. With stable Rust 1.98.1, the production crate builds for `wasm32-wasip2`; its component validates and `component wit` reports the internal `porffor:internal/api` import and public `wasi:cli/run@0.3.0` export. The separate direct-driver fixture also builds on Wasip2 with the Wasip3 crate. Object-link tests pass with the updated lockfile.

Added a dedicated static-link crate using the same runtime/driver source with a `static-link` feature. On `wasm32-wasip2`, that feature keeps `main` as a native symbol for wasm-ld instead of a WIT import; it builds only a Rust static archive, avoiding the separate component-link step. Linked this archive with the compiler's relocatable program object and the target's WASI libc. The Rust command driver, Porffor runtime services, and JS program now share one core module and one linear memory. Its WIT metadata componentizes directly, with the final public export limited to `wasi:cli/run@0.3.0`; pinned Wasmtime 49 prints `42` and `Hello`.

The merged Rust `name` custom section from wasm-ld has stale subsection offsets that made component encoding fail with an unexpected EOF. Removing debug and name custom sections before `component new` preserves the WIT metadata and fixes componentization. Added [runtime-wasip2-command-link.test.mjs](../tests/runtime-wasip2-command-link.test.mjs) to reproduce the full link and execution when the Wasip2 target is installed; it skips cleanly without that target. The test passes here. The object-link tests also pass and `git diff --check` is clean. No GitHub CI was run.

## Increment 12 — compiler CLI direct-link route (2026-09-24)

Wired the proven static-link packaging path into `scripts/compile-component.mjs` as the opt-in `--linked` mode. It compiles dynamic JS through the relocatable object backend, builds the Rust runtime/command archive for `wasm32-wasip2`, links program, runtime and command driver into one core module with the Rust toolchain's `wasm-ld`, then componentizes the WIT-described WASI command directly. The existing default adapter path and `--primitives` path remain available.

Verified the user-facing route locally with a JS file that prints a number and string: `node scripts/compile-component.mjs --linked input.js output.wasm` produced a component that passed `wasm-tools validate`; pinned Wasmtime 49 ran it and printed `42` and `Hello`. The focused regression tests `runtime-production-object-link.test.mjs` and `runtime-wasip2-command-link.test.mjs` both pass after the Rust driver cfg update. The latter checks the final component exports `wasi:cli/run@0.3.0` and that execution shares runtime output state correctly.

This completes a vertical prototype through CLI packaging for the tested scalar and string path. The `--linked` mode currently requires stable Rust with the `wasm32-wasip2` target, pinned Wasmtime 49 and the pinned wasm-tools 1.259 tool; it is not yet the default compiler mode. Broader dynamic JS/runtime coverage, especially heap objects, GC behavior, exceptions and unsupported language features, remains to be tested before changing defaults. No GitHub CI was run, and nothing was pushed.

## Increment 13 — direct-link array smoke coverage (2026-09-24)

The first CLI probe with `[1, 2, 3]` failed at the relocatable-object backend's operation whitelist, even though the runtime helper implementations and global relocations were already present. Expanded the object mode to admit the basic array operations already emitted by the dynamic IR: allocation, indexed get/set, length, and dynamic addition. No new allocator or GC implementation was added in this slice; these helpers resolve against the production Rust runtime archive.

Expanded [runtime-wasip2-command-link.test.mjs](../tests/runtime-wasip2-command-link.test.mjs) to componentize and execute the number/string smoke case and an array case that allocates, mutates an indexed element, adds a number, and reads `length`. Added a third case with a deliberately smaller 256 KiB heap: it retains one array while allocating 12,000 temporary arrays, forcing collection, then reads the retained element. Outputs are `42`/`Hello`, `42`/`3`, and `7`; all components validate and expose only `wasi:cli/run@0.3.0`. All four direct-component/object-link tests pass, and `git diff --check` is clean. This does not test arbitrary heap objects or all root/collector edge cases. No GitHub CI was run.

AI disclosure: OpenAI Codex performed and documented the toolchain probes. No remote PR, message, or push was submitted.

## Increment 9 — captured arrow closures and indirect calls (2026-09-24)

Added a bounded closure runtime slice. Synchronous arrow functions can capture lexically visible `const` bindings, be assigned to locals, returned from functions, and called indirectly. Each closure owns a heap environment object. Closure calls pack arguments into an array and share a uniform `(environment, arguments) -> jsval` Wasm signature. The backend dispatches on the checked closure target index. Wasm tables and element sections were rejected by the current component adapter, so dispatch stays within the adapter's supported core module subset.

Closure blocks use a dedicated function jsval tag and hold the target index plus an environment reference. Marking visits the closure environment, which in turn retains captured strings and heap values. The test interpreter models the same closure layout behavior.

The supported source boundary requires captured bindings to be `const`. Mutable captures, function declarations/expressions used as values, `this`, `arguments`, async/generator functions, constructors, direct closure printing/equality and arbitrary callable values remain unsupported. Missing and extra arguments use the packed argument-array behavior: missing values read as undefined and extra values are unused.

Added six shared Node/C/Wasm/component cases covering lexical capture, separate environments, runtime target selection, returned closures under collection pressure, captured-string retention, and block-bodied arrows. Focused closure validation passes: 9 core tests, 6 differential tests, and 6 component tests. The broader 370-test IR/backend suite and repository baseline both pass, including closure differential and component checks.

AI disclosure: OpenAI Codex authored this increment. Work remains local; no remote PR, message, or push was submitted.

## Increment 8 — explicit object prototype chains (2026-09-24)

Added the minimal explicit prototype surface through unshadowed `Object.create(proto)`, where `proto` must be an object or `null`. Reads search own fields, linked overflow pages, and then each prototype. Writes continue to affect only the receiver's own fields. Ordinary literals use a null-like prototype because built-in `Object.prototype` behavior is outside this runtime slice; prototype mutation and built-in prototype objects remain unsupported.

Expanded the object payload with a traced prototype reference and moved property slots by eight bytes. The collector marks prototype links along with overflow pages, keys, and values. The lowered interpreter models the same lookup behavior. Tests cover multi-level inheritance, own-property shadowing, null prototypes, primitive-prototype rejection, shadowed `Object`, and a prototype retained solely through a returned child during forced collection.

`node --test tests/object-values.test.mjs`, `node --test tests/object-differential.test.mjs`, and `node --test tests/object-component.test.mjs` pass (23, 12, and 14 tests). This includes Node/C/Wasm differential behavior and Wasmtime component runs. The combined 361-test IR/backend regression command and `git diff --check` also pass.

AI disclosure: OpenAI Codex authored this increment. Work remains local; no remote PR, message, or push was submitted.

## Increment 7 — expandable object property storage (2026-09-24)

Added linked property pages so an ordinary object can grow while preserving its identity. Each object keeps eight inline slots. When those fill, a new eight-slot heap page is linked from the stable object block. Further pages chain from that page. Page blocks use the same checked object representation, allowing the existing tag-directed collector to mark each page and recursively retain its keys and values. Fixed and computed string keys use the same lookup path.

Reads and updates walk the inline slots and then each page. An append fills the first page with free slots or allocates and links another page. Collection during page allocation is safe because the owning object and assigned key/value remain in the caller's explicit root frame; pages already linked from the object are reachable to the collector. Arena exhaustion remains a trap.

Updated the prior capacity test to exercise 25 fields across multiple pages, and changed the unsupported-key case to reject a numeric key rather than the now-supported string key. Added a shared dynamic-string-key fixture covering read, update, and append. Fixed a Wasm stack imbalance in the page-link initialization found by validation. `node --test tests/object-values.test.mjs`, `node --test tests/object-differential.test.mjs`, and `node --test tests/object-component.test.mjs` all pass (18, 11, and 13 tests respectively), including Node/C/Wasm differential and Wasmtime component execution. The 357-test IR/backend regression set also passes, as does `git diff --check`.

AI disclosure: OpenAI Codex authored this increment. Work remains local; no remote PR, message, or push was submitted.
