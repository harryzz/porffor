# Phase 5 increment 4: arrays and Uint8Array

The explicit `--primitives` path now supports dense array literals and `new Uint8Array(length)`. Both forms pass through locals, control-flow edges, direct calls and returns. Supported operations are `.length`, numeric indexed reads, indexed assignment and truthiness.

```sh
node scripts/compile-wasm.mjs --primitives examples/arrays/values.js /tmp/arrays.wasm
node scripts/run-numeric-wasm.mjs /tmp/arrays.wasm
node scripts/build-component-runtime.mjs
node scripts/compile-component.mjs --primitives examples/arrays/values.js /tmp/arrays.component.wasm
node scripts/run-component.mjs /tmp/arrays.component.wasm
```

The default numeric mode remains unchanged. The WIT and runtime host capabilities are also unchanged; allocation, indexed operations and tracing are emitted in core Wasm.

## Source contract

Array literals must be dense: holes and spread elements are rejected. Their length is fixed in this increment. Reads with negative, fractional or out-of-range numeric indices return undefined. Assignment is supported only for an existing array index; an out-of-range ordinary-array write traps because property creation and length growth require the later object/property model. Numeric-string indices are rejected before lowering.

`new Uint8Array(length)` accepts a nonnegative integral numeric length that fits the program arena. Elements start at zero. Reads outside its bounds return undefined and writes outside its bounds are ignored. Assignment expressions return the original right-hand value while the stored byte is converted. The implemented conversion covers NaN and finite values in the signed 32-bit range, truncates fractions and takes modulo 256. Larger finite values and infinities trap pending the complete ECMAScript integer-conversion helper. Construction from arrays, buffers or other typed arrays is not implemented.

Array objects are always truthy. Direct array printing, identity equality, string coercion, methods, iteration, deletion, ordinary named properties, array growth and nested indexed access are rejected. The conservative closed-program type analysis allows element reads when their possible types are supported; it does not yet perform per-allocation points-to analysis, so nested array access is outside this increment.

## Representation and collection

The packed tags retain upstream internal type IDs: Array is `0x48` and Uint8Array is `0x51`. The low 32 bits hold the stable payload pointer. Both use the collector's eight-byte block header.

| Value | Payload layout |
| --- | --- |
| Array | u32 length, four reserved bytes, then packed i64 jsval elements |
| Uint8Array | u32 length, then byte elements |

Ordinary array elements are initialized to undefined before the object becomes visible. Uint8Array storage is zero-filled. Block sizes and payload spans are checked against the arena, and pointers must refer to allocated blocks with the matching tag.

The mark phase now dispatches by heap tag. Strings and Uint8Array instances are leaves. Arrays are marked before recursively tracing every packed element, which handles shared children, mutations and cycles. There is no write barrier because collection occurs synchronously only inside allocation and every mutation completes before another source operation can allocate. Shadow-stack and pooled-literal roots retain the increment 3 contract.

## Verification

The array core suite covers mixed values, mutation, calls, invalid reads, assignment results, truthiness, typed-byte conversion, collector pressure, mutated child references and cycles. Ten Node/C/Wasm differential fixtures cover the supported behavior. The retained C backend agrees on nine; its out-of-bounds typed-array fixture terminates with `SIGSEGV`, which is asserted explicitly. Twelve component tests run the same features through Wasmtime, preserve the command WIT snapshot, and allocate beyond bump capacity while keeping array children and a cycle live.

See [the Phase 5 work log](phase-5-work-log.md) for baseline results. [Ordinary objects and fixed properties](object-values.md) are implemented in the next increment and reuse the collector's type dispatch for property values. Broader typed arrays remain separate because their numeric representations and conversion rules differ.
