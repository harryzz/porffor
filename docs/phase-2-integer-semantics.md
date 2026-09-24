# Phase 2, increment 2: explicit 32-bit operations

This increment adds integer lowering through standard JavaScript operations. It does not add custom TypeScript `i32` annotations or change ordinary Number arithmetic.

## Source contract

The numeric subset now accepts `&`, `|`, `^`, `~`, `<<`, `>>`, `>>>`, their binary compound assignments, and exactly two numeric arguments to unshadowed `Math.imul`. General coercion from booleans/strings/objects is still outside the subset. `Math` cannot be rebound or mutated by supported code. Arguments are evaluated left to right, including compound-assignment left-value capture.

Bitwise and imul results remain JavaScript Numbers. They can be passed to existing functions, used in loops, mixed with floating arithmetic, compared with booleans and printed without being mistaken for boolean values.

## Lowered contracts

| Operation | Signature and behavior |
| --- | --- |
| `F64ToInt32` | f64 -> i32: truncate toward zero, reduce modulo 2^32, interpret signed; nonfinite values and either zero sign become 0 |
| `F64ToUint32` | f64 -> u32: same reduction, unsigned interpretation |
| `I32ToF64`, `U32ToF64` | exact conversion to Number, respecting signedness |
| `I32BitAnd`, `I32BitOr`, `I32BitXor`, `I32BitNot` | fixed-width integer bit operations |
| `I32ShiftLeft`, `I32ShiftRight` | i32 operands, low five count bits; wrapping left shift or sign-extending right shift |
| `U32ShiftRight` | u32 left operand, i32 count, low five count bits; zero-filling result u32 |
| `I32Multiply` | wrapping low 32-bit product, used for `Math.imul` |

Conversions follow the numeric portion of ECMAScript [ToInt32](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-toint32) and [ToUint32](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-touint32). Multiplication follows [Math.imul](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.imul). These source semantics were checked against the official specification during implementation.

The lowering uses signed converted imul operands because their low 32 product bits are identical to the unsigned product's low bits. Shift counts can likewise use signed conversion before masking: their low five bits are unchanged.

`F64ToInt32`/`F64ToUint32` are backend-neutral conversion operations with explicit modulo semantics. The [direct Wasm emitter](core-wasm.md) implements that contract with an internal bit-extraction helper; a trapping or saturating Wasm float-to-int instruction alone is insufficient. No C cast/source string is present in these nodes.

Every integer result is converted back to f64 at the semantic Number boundary. This intentionally leaves conversion elimination for a later proof-driven optimization. Ordinary `*` still selects `F64Multiply`: `(4294967295 * 4294967295) | 0` is 0 after binary64 rounding, whereas `Math.imul(4294967295, 4294967295)` is 1. Replacing one with the other would be incorrect.

## Checks and usage

```sh
node scripts/compile-numeric.mjs examples/numeric/integers.js /tmp/porffor-integer-ir
node --test tests/ir-v2.test.mjs tests/numeric-pipeline.test.mjs tests/integer-lowering.test.mjs tests/numeric-differential.test.mjs
```

Tests include independent BigInt-based modulo/product expectations, conversion range boundaries, signed zero, nonfinite inputs, shift-count masking, compound assignments, typed validator rejection and lexical Math shadowing. Ten integer fixtures extend the mandatory Node/new-IR/C comparison. The pre-existing C evaluation-order regression remains a named assertion, not an ignored mismatch.

See [the work log](phase-2-work-log.md) for actual final counts and baseline results. The production C backend is unchanged. This is still source-to-IR compilation; direct Wasm and WASI packaging remain later milestones.
