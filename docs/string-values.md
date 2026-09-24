# Phase 5 increment 2: strings and a bounded heap

The explicit `--primitives` path now supports UTF-16 string literals, concatenation (including number/boolean/null/undefined conversion), `.length`, strict content equality, truthiness and output. Strings pass through locals, CFG edges, direct calls, returns and recursion. The default numeric path is unchanged.

```sh
node scripts/compile-wasm.mjs --primitives examples/strings/greeting.js /tmp/strings.wasm
node scripts/run-numeric-wasm.mjs /tmp/strings.wasm
node scripts/build-component-runtime.mjs
node scripts/compile-component.mjs --primitives examples/strings/greeting.js /tmp/strings.component.wasm
node scripts/run-component.mjs /tmp/strings.component.wasm
```

Both paths print `Hello, WASI`, `11`, `value=42`, `😀` and `true`, one per line.

## Source and IR contract

`JsString` lowers to `ValueString`; `JsStringLength` lowers to checked `StringLength` and number boxing. In string-bearing modules `JsAdd` lowers to `ValueAdd`: either string operand selects concatenation, otherwise primitive numeric addition applies. Operands are evaluated in source order before conversion. String literals are pooled and lazily allocated once per instance. No optimizer reorders allocating operations.

A conservative closed-program type analysis propagates possible types through calls, returns and CFG edges. `.length` requires a proven string. Possible string inputs to numeric conversion, ordering, bitwise operations and numeric argument indices are rejected. The analysis has no branch refinement. String indexing, methods, coercive equality, objects and their conversion hooks remain unsupported. An unused function whose parameter has no string evidence cannot use `.length`.

The semantic contract follows ECMAScript [String values](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-string-type) and [ToString](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tostring) for the supported primitives. Length counts UTF-16 code units. Equality compares code units, without normalization. Lone surrogates remain distinct internally; output encodes them as replacement characters. Embedded NUL is preserved in output.

## Ownership, layout and collection

Each string-enabled instance owns a **4 MiB arena** with a nonmoving mark-sweep collector. The first 64 KiB is an explicit shadow stack; the remaining region stores objects. Smaller test arenas reserve one eighth for roots. Allocation first uses a free block or the bump cursor. If neither fits, it traces, sweeps, coalesces adjacent free blocks, and retries before trapping. An unrecoverable live-set exhaustion is a core trap, not a JavaScript exception.

Every emitted string-bearing function reserves one shadow-stack slot for each jsval parameter and local. Slots are initialized to undefined, updated after local and parallel-edge assignments, and released on normal return. Helper operations temporarily root intermediate strings across allocating conversions and concatenation. Recursive calls create nested frames. Cached literal pointers are scanned as permanent global roots. The current collector traces strings as leaf objects; later object types will add type-directed child tracing. Wasm traps do not execute frame cleanup, so catching a core trap and invoking the same standalone instance again can retain abandoned root slots. Command traps terminate the instance.

A string jsval is `VALUE_PATTERN | (0x43 << 43) | pointer`, with a u32 linear-memory offset in the payload. Zero is not a valid string pointer. Each eight-byte-aligned heap block has an eight-byte collector header containing block size and mark/allocation state. The public string pointer follows it: u32 code-unit length at offset 0, then u16 units at offset 4, padded to the block boundary. This retains the upstream visible UTF-16 layout without the byte-string specialization. Size arithmetic is bounded before allocation or copying. Consumers check tags, reserved bits, alignment, allocation state, block bounds and payload span.

Standalone core modules import memory from `porffor`; the Node runner supplies the arena starting at offset 8. Component adapters import `__main_module__.memory`. The fixed Rust wrapper reserves a separate `Vec<u64>` region, never resizes/frees it, and exports its base. This prevents overlap with runtime/canonical-ABI allocations. Heap initialization checks nonzero base, alignment and memory size before committing its globals. A failed initialization remains failed on retry.

The Wasm backend emits allocation, literal construction, UTF-16 copying, content comparison, truthiness, dispatch and pointer checks directly as binary instructions. No JS evaluation or source-to-Rust translation is introduced. The wrapper exposes three typed capabilities alongside memory:

| Capability | Signature | Responsibility |
| --- | --- | --- |
| `string_heap_base` | `() -> i32` | Supply stable, aligned arena base |
| `print_string` | `(i32 pointer, i32 units) -> ()` | Bounds-check and append UTF-8 output |
| `format_number` | `(f64, i32 destination) -> i32` | Write at most 64 UTF-16 units, return length |

Node uses Number-to-string conversion; Rust uses the already pinned `ryu-js` formatter and converts either zero sign to `"0"` for concatenation. The emitted code owns the allocated formatting buffer and validates returned length. Neither host interprets boxed values. The component WIT and existing buffered-output/termination contract are unchanged.

`ValueString` and `ValueAdd` declare allocation, memory access and trap effects. String length/equality/truthiness declare memory reads and traps. String-free primitive modules retain their existing memory-free ABI. `linear-ptr` still has no general executable mapping.

## Verification and limitations

The suites now contain 42 IR/core tests, 22 Node/C/Wasm differential fixtures and 28 component tests. Collector pressure tests use small arenas to force repeated cycles and cover calls, recursion, live returns, loop-carried values and parallel CFG edges. The component test allocates beyond the 4 MiB bump capacity while retaining a live string. Other coverage includes Unicode, surrogates, NUL, number formatting, operand order, cached literals, instance isolation, large literals, bad pointers/headers, failed initialization, live-set exhaustion and runtime boundary checks.

Node, test IR, core Wasm and component output agree on the supported cases. Six legacy C discrepancies are asserted exactly, not skipped: number formatting, operand evaluation order, surrogate-pair output, lone-surrogate output, embedded NUL output and Unicode output. Metadata in `tests/helpers/string-cases.mjs` records the expected legacy stdout and explanation. UTF-16 output in the old C path loses high bytes; this does not affect the new backend's internal representation.

Both baseline scripts include these suites, so the existing foundation CI jobs run them. See [the work log](phase-5-work-log.md) for final results. The subsequent [array increment](array-values.md) adds type-directed tracing for packed Array elements and leaf Uint8Array storage. Ordinary objects, closures, indirect calls, exceptions and broader built-ins remain later migrations.
