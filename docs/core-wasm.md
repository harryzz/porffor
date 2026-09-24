# Experimental direct core-Wasm backend

Phase 3 emits standalone core WebAssembly directly from validated lowered IR. The production CLI continues to use the retained C backend. The experimental path is:

```text
JS numeric subset -> semantic CFG -> typed CFG -> Wasm bytes
```

No C/Rust source, native compiler, Wasm text assembler or external encoder is involved in emission. The development host uses Node 20.19.2's WebAssembly engine. These core bytes are not themselves a WASI command or Component Model binary. [Phase 4 packaging](wasip3-command.md) now wraps them as a WASI 0.3 command. JS async, GC and dynamic runtime features remain unimplemented.

## Compile and run

From the checkout root:

```sh
node scripts/compile-wasm.mjs examples/numeric/add.js /tmp/add.wasm
node scripts/run-numeric-wasm.mjs /tmp/add.wasm
# 42
node scripts/compile-wasm.mjs examples/numeric/sum.js /tmp/sum.wasm
node scripts/run-numeric-wasm.mjs /tmp/sum.wasm
# 45
node scripts/compile-wasm.mjs examples/numeric/integers.js /tmp/integers.wasm
node scripts/run-numeric-wasm.mjs /tmp/integers.wasm
# 4294967295
# -2
# 48
```

The compiler validates both IR layers and the generated binary before writing the output file. It does not execute the program. The runner instantiates the module and invokes `main` explicitly; there is no Wasm start section. Compile and run errors produce a nonzero exit status. The output's parent directory must already exist.

For API use, `emitCoreWasm(loweredModule)` from `compiler/backends/wasm/index.mjs` returns a `Uint8Array`. It validates lowered IR and rejects unsupported representations before encoding. Repeated emission is deterministic and does not mutate the input.

## Current binary and host contract

- Numeric IR types `i32/u32`, `i64/u64`, and `f64` map to Wasm `i32`, `i64`, and `f64`. Signedness selects comparisons and conversions; integer arithmetic wraps at its declared width. `jsval` maps to i64 for the explicit [primitive mode](primitive-values.md); `linear-ptr` remains rejected.
- All current lowered scalar operations are supported: constants, arithmetic, comparisons, bit operations, shifts, numeric truthiness and the documented JS integer conversions. Direct calls include recursion and void calls.
- Each IR function is exported under its IR name. The source frontend generates a zero-argument void `main`; other generated symbols expose specialized machine signatures for testing, not a public JS ABI. The JS host API returns signed bit patterns for i32/i64 even when the IR type is unsigned. i64 arguments/results use BigInt. The source frontend still does not accept TypeScript integer annotations or BigInt source expressions.
- `PrintNumber` selects `porffor.print_number: (f64) -> ()`; `PrintBoolean` selects `porffor.print_boolean: (i32) -> ()`. Only used print imports are emitted. The host interprets nonzero booleans as true and owns text formatting. There are no conversion or evaluation imports. Phase 4 additionally supports the fixed numeric `argument_count: () -> f64` and `argument_number: (f64) -> f64` capabilities; see the [argument contract](wasip3-command.md#numeric-command-arguments).
- Instantiation does not print or run source code. Explicit entry calls preserve instruction and print order. A host print exception propagates to the caller; no JS exception semantics are claimed.
- Type, import, function, export and code sections are encoded directly, with a function-name custom section. There is no memory, table, data segment, source map or Component Model metadata.

## Control flow

Each SSA value and block parameter receives a Wasm local. A per-function program-counter local selects blocks inside a dispatcher loop. Each block tests its index; a branch copies edge arguments, updates the program counter and branches back to the loop. Returns use Wasm `return`. An impossible program counter traps.

All source operands are pushed before destination block parameters are assigned in reverse order. This preserves simultaneous assignment even for self-loop argument swaps. Entry order is independent of the block array order. The dispatcher also supports irreducible CFGs, avoiding an assumption that every validated graph originated from structured JS. It prioritizes correctness over code size or speed; optimized structurization and local allocation are future work.

## JavaScript integer conversions

`F64ToInt32` and `F64ToUint32` call a private emitted Wasm helper. It reinterprets binary64 bits, extracts exponent/significand, shifts out the fractional part, retains the low 32 bits, and applies the sign. Exponents below zero produce zero; exponents at least 84 also produce zero because finite values have no nonzero low 32 integer bits. That latter branch also handles NaN and infinity. The unsigned/signed result shares the same i32 bits; subsequent operations choose signedness.

This implements the [Phase 2 conversion contract](phase-2-integer-semantics.md) without trapping/saturating float conversion, floating remainder cancellation, or a JavaScript host fallback. Tests cover both signs, every encoded exponent and four significands against an independent BigInt modulo oracle (16,384 input bit patterns).

## Verification and limits

```sh
node --test tests/ir-v2.test.mjs tests/numeric-pipeline.test.mjs tests/integer-lowering.test.mjs tests/wasm-backend.test.mjs
PHASE2_CC=/usr/bin/clang-19 node --test tests/numeric-differential.test.mjs
node scripts/baseline.mjs
```

Every source differential case validates and executes the emitted bytes. Integer checks also execute Wasm, including the independent BigInt boundary and product checks. Backend tests cover scalar widths, IEEE special values, irreducible control flow, parallel edge assignment, import/effect behavior, malformed input, multi-byte indices/section lengths, and CLI compilation/execution. The known original C evaluation-order discrepancy remains a separate explicit baseline assertion; Wasm agrees with Node and the IR interpreter.

Core validation uses Node/V8; Phase 4 also executes the 33 source fixtures as components in pinned Wasmtime. Programs execute synchronously without a fuel limit; source nontermination remains nontermination. Performance, dynamic values, closures, memory/GC, exceptions, richer metadata and further WASI integration remain future work. Basic command packaging is available in Phase 4. See [numeric-subset.md](numeric-subset.md) for all source restrictions.

Encoding references: [official core binary instructions](https://webassembly.github.io/spec/core/binary/instructions.html) and [module sections](https://webassembly.github.io/spec/core/binary/modules.html), consulted during implementation.

Phase 5 adds an opt-in `--primitives` mode to the same compilation commands. Its boxed representation and additional print capabilities are documented in [primitive-values.md](primitive-values.md). The default numeric path remains available.

The subsequent [string increment](string-values.md) extends `--primitives` with UTF-16 strings and a separate bounded arena. Rebuild the command wrapper for its typed string capabilities; the WIT is unchanged.

[Arrays and Uint8Array](array-values.md) reuse that arena and add type-directed tracing entirely inside emitted core Wasm. They add no host imports and do not change the command WIT.
