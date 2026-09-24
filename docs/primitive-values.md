# Phase 5 increment 1: boxed primitive values

This document records the first increment. The subsequent [string increment](string-values.md) extends the same `--primitives` mode with a bounded heap and string operations; string exclusions and heap plans below describe the earlier milestone.

This increment establishes the dynamic-value boundary with numbers, booleans, null and undefined. It supports mixed-type locals, CFG joins, direct-function parameters and returns, and primitive numeric coercion. It does not yet allocate a JavaScript heap or implement strings, arrays, objects, closures or GC.

The existing numeric lowering remains the default. Select the new path explicitly:

```sh
node scripts/compile-numeric.mjs --primitives examples/primitives/values.js /tmp/values-ir
node scripts/compile-wasm.mjs --primitives examples/primitives/values.js /tmp/values.wasm
node scripts/run-numeric-wasm.mjs /tmp/values.wasm
node scripts/build-component-runtime.mjs
node scripts/compile-component.mjs --primitives examples/primitives/values.js /tmp/values.component.wasm
node scripts/run-component.mjs /tmp/values.component.wasm
```

Both execution paths print:

```text
null
42
3
undefined
false
```

The API equivalents are `buildSemantic(source, {dynamic: true})`, `lowerPrimitives(semanticModule)`, then `emitCoreWasm(loweredModule)`. Component compilation selects the existing `command-adapter` target and standard packager. No source-language intermediary or host evaluation callback is added.

## Source contract

The [numeric subset](numeric-subset.md) remains available, with these additions in primitive mode:

- Null literals; unshadowed `undefined`, `NaN` and `Infinity`.
- Uninitialized `let` binds undefined when its declaration executes. Reads before declaration, self-initialization, const assignment and unsupported captures remain errors.
- Bare `return` and function fallthrough return undefined. Direct calls retain the existing exact-arity restriction.
- Locals, block arguments and functions may carry different primitive types. A generic identity function no longer needs numeric call-site evidence.
- Arithmetic, unary numeric operators, bitwise/shift operators and `Math.imul` apply primitive numeric conversion. Null and false become +0, true becomes 1, undefined becomes NaN. `+` is numeric here because string and object input is rejected by this mode.
- Update expressions convert the old value before producing a postfix result: `let x=true; console.log(x++)` prints 1, then x is 2.
- Truthiness and strict equality preserve primitive types: null differs from undefined; booleans differ from numbers; either zero sign is falsy and compares equal; NaN is falsy and does not strictly equal itself.
- Valid lexical/parameter shadowing of built-in primitive identifiers works. Top-level lexical or function declarations conflicting with protected `undefined`, `NaN` or `Infinity` are rejected for Script semantics. Differential Node tests execute a `vm.Script`, avoiding CommonJS wrapper scope differences.

`Porffor.argumentNumber` still requires a Number index. In primitive mode a non-number index triggers a checked core trap; it is not silently coerced. Invalid numeric indices and parsing failures retain the documented NaN result. The numeric mode rejects statically known boolean indices during lowering as before.

This primitive-only increment rejects strings, regex literals, BigInt literals, symbols, objects, arrays, closures, property access, indirect calls, coercive equality, `typeof`, `void`, exceptions and async. Later bounded heap migrations add strings, arrays, objects and captured arrow closures; see the [string](string-values.md), [array](array-values.md), [object](object-values.md) and [closure](closure-values.md) contracts. Unknown operations fail explicitly rather than falling through to numeric coercion.

Semantic reference: ECMAScript [ToNumber](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber), [ToBoolean](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-toboolean), and [IsStrictlyEqual](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-isstrictlyequal). The implemented subset excludes objects and their observable conversion hooks.

## Representation

The retained native backend uses a split `{value, type}` in many computations and packs values when storing them. The new `jsval` backend representation follows its scalar packed layout (`compiler/render.js`, `porf_pack`/`porf_unpack`; type IDs in `compiler/types.js`). It does not copy native C struct layout or stack scanning.

| Value | Wasm representation |
| --- | --- |
| `jsval` | i64 bit pattern |
| Finite Number, infinity, signed zero | IEEE binary64 bits |
| NaN produced by boxing | Canonical `0x7ff8000000000000` |
| Undefined | `0xfff8000000000000` |
| False | `0xfff8100000000000` |
| True | `0xfff8100000000001` |
| Null | `0xfff8380000000000` (object tag, zero payload) |

The boxed prefix is `0xfff8000000000000`; type IDs occupy bits 43–50 and payloads use the low 32 bits. NaN canonicalization prevents arithmetic or external numeric NaNs from colliding with tags. This increment canonicalizes all boxed NaNs; preserving NaN payloads is not a JS observable requirement for these primitives. Signed zero is preserved.

This is the scalar packing convention for primitive consumers. The native array-specific `JV_ZERO_BITS` convention distinguishes a stored zero from an empty slot in heap-aware array helpers. Primitive-only consumers trap on non-null object/string tags, invalid boolean payloads and other unsupported boxed values; heap-aware helpers are documented by the later value contracts. `linear-ptr` still has no executable backend mapping.

Exported internal functions with jsval parameters/results use raw i64/BigInt bits at the core-Wasm API. That is an internal compiler ABI, not a public JS or WIT value ABI. Callers must use valid packed values. This representation does not add general JavaScript argument marshalling to exported functions.

## IR and direct execution

`lowerPrimitives` is separate from the monomorphic `lowerSemantic`. Every semantic value and block parameter is represented as jsval, while temporary arithmetic/conversion results remain typed f64/i32/u32. Direct calls and parallel CFG edge assignments preserve boxed values without conversion.

New checked lowered operations are:

| Operation | Signature |
| --- | --- |
| `ValueNull`, `ValueUndefined` | `() -> jsval` |
| `ValueBoxNumber` | `(f64) -> jsval` |
| `ValueBoxBoolean` | `(i32) -> jsval` |
| `ValueToNumber` | `(jsval) -> f64` |
| `ValueUnboxNumber` | `(jsval) -> f64`, number-only check |
| `ValueTruthy` | `(jsval) -> i32` |
| `ValueStrictEqual` | `(jsval, jsval) -> i32` |
| `PrintValue` | `(jsval) -> ()`, host-write |

Validators reject operand/result mismatches, malformed constants and extra attributes. Conversion/truthiness/equality helpers declare possible trapping for unsupported runtime values. Instruction order remains fixed; no optimizer is introduced. These internal traps are not JavaScript exceptions or completion records.

The backend emits helpers directly as core-Wasm instructions. Strict equality compares Number values using f64 equality and valid tagged values by bits; it validates both operands. Printing dispatches in Wasm to the existing number/boolean imports or fixed `print_null: () -> ()` / `print_undefined: () -> ()` imports. Neither host decodes boxed values. The WASI wrapper merely adds fixed text appenders; its WIT interface and buffering/termination contract are unchanged.

The test-only IR interpreter represents primitives using native JS values, independently of bit encoding, and is not used by generated programs. Pure boxed computation imports no evaluator, allocates no memory and needs no GC roots yet.

## Heap and GC plan — not implemented in this increment

This is the explicit next boundary, not a claim that a collector exists:

| Area | Planned contract / required next work |
| --- | --- |
| References | Stable u32 offsets in the low payload bits; offset zero reserved for null. No native pointers in jsval. |
| Storage | Linear-memory objects with typed layouts and a tracing collector. Retain upstream type IDs where compatible. |
| Strings first | Preserve JS UTF-16 code units, including lone surrogates. The upstream string layout stores length at offset 0 and units from offset 4; byte-string specialization is optional. Add string literals, concatenation, length, equality, truthiness and output incrementally. |
| Memory ownership | Select and test an explicit program heap region. The Rust command wrapper's memory/output buffers are not an existing JS heap. Component adapter linkage must make the chosen memory visible without overlapping canonical-ABI/runtime allocations. Standalone core and component paths must share the same value/layout contract. |
| Allocation | Checked sizes, alignment, capacity and memory-growth failure; an explicit allocation effect and failure policy before enabling allocating operations. Do not silently reinterpret an allocation failure as null. |
| Roots | Spill live jsval references into an explicit linear-memory shadow stack at allocation/call safepoints; maintain frame links across recursion. No conservative native stack/register scan. Verify loop-carried references and parallel edge assignments under collection. |
| Collection | Nonmoving tracing initially; no reclamation before all live references, globals and host-owned handles have explicit roots. Add allocation-pressure and repeated-collection tests before calling GC complete. |
| Exceptions | Separate completion/exception lowering is required before source throw/catch or object coercion hooks. Primitive contract traps do not substitute for JS exceptions. |
| Later migrations | Typed arrays, mutable closure captures, general callable values, exceptions, built-ins and WIT bindings. Each needs declared effects and Node/C/Wasm differential evidence. |

No speculative allocator API, fake collector, string handle table or hidden host-object representation is introduced by this milestone. Unsupported heap-bearing values trap rather than entering the primitive path.

## Verification and reference discrepancies

The native baseline now includes primitive validator/backend tests and a 20-case primitive differential suite. The component baseline additionally runs 54 boxed-value tests, including all 33 numeric fixtures through boxed lowering and the CLI path. Tests cover exact tags, NaN collisions, signed zero, truthiness/equality cross products, malformed tags, coercions, updates, mixed CFG values, recursion, shadowing, implicit returns and unchanged numeric-mode diagnostics.

Node/IR/Wasm agree on all 20 new cases. The original C backend agrees on 15; five explicit discrepancies are retained:

| Fixture | Expected | Recorded C behavior |
| --- | --- | --- |
| Mixed function return | 42, null | 42, blank line |
| Polymorphic identity | 3, false, null, undefined | Null prints as a blank line |
| Update coercion | 1, 2, 0, -1, NaN | true, 2, null, -1, 1 |
| Block-scoped undefined shadowing | 7, false | Exit 1, redeclaration SyntaxError |
| Block-scoped NaN/Infinity shadowing | null, false | Exit 1, redeclaration SyntaxError |

Every C discrepancy has a named explanation and exact stdout or exit/stderr assertion. It is not accepted as equivalent or skipped. Ordinary C `nan`/`-nan`/`inf` spelling is normalized only for numeric value comparison. The previously known C evaluation-order regression in the original numeric fixtures also remains unchanged.

See [phase-5-work-log.md](phase-5-work-log.md) for reproduction artifacts, full checks and the next increment.
