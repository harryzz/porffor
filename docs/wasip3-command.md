# Experimental numeric pipeline

This documents the default numeric mode. Phase 5 adds a separate [boxed primitive mode](primitive-values.md) selected with `--primitives`; its broader acceptance does not change these numeric restrictions.

This is the numeric Phase 2 pipeline, including [increment 2 integer operations](phase-2-integer-semantics.md):

```text
JavaScript source
  -> existing Porffor parser and binding analysis
  -> validated JavaScript semantic CFG
  -> number/boolean constraints and numeric lowering
  -> validated backend-neutral typed CFG
  -> direct core Wasm (Phase 3)
```

The production CLI still compiles through the original C backend. The experimental path now supports [direct core-Wasm emission](core-wasm.md), and [WASI 0.3 command packaging](wasip3-command.md). A test-only interpreter executes the lowered CFG as an independent comparison path; it is not a production runtime or final compiler architecture.

## Try it

From the `porffor/` checkout, with Node 20.19.2:

```sh
node scripts/compile-numeric.mjs examples/numeric/add.js /tmp/porffor-add-ir
node scripts/compile-numeric.mjs examples/numeric/sum.js /tmp/porffor-sum-ir
node --test tests/ir-v2.test.mjs tests/numeric-pipeline.test.mjs tests/integer-lowering.test.mjs
PHASE2_CC=/usr/bin/clang-19 node --test tests/numeric-differential.test.mjs
```

Each compile writes `semantic.txt` and `lowered.txt` after both validators pass. These are human-readable dumps, not a stable serialization format. They preserve `-0`, `NaN` and infinities. The tool does not execute user programs. Diagnostics include source offsets for subset restrictions and symbolic value IDs for lowering conflicts.

The sum example produces loop-header, body and exit blocks with explicit block parameters. The add example retains `JsAdd` in semantic IR and selects `F64Add` only in numeric lowering. Source function names map to generated symbols; the generated `main` is a zero-argument, void entrypoint for the closed program.

## Accepted source

- JavaScript numeric and boolean literals, including nonfinite values produced by arithmetic.
- Initialized `let` and `const`, lexical block/for scopes, shadowing and parameter assignments.
- Number-only `+`, `-`, `*`, `/`, unary `+` and `-`, assignments `=`, `+=`, `-=`, `*=`, `/=`, and prefix/postfix `++`/`--`.
- Number-only bitwise operators `&`, `|`, `^`, `~`, shifts `<<`, `>>`, `>>>`, compound bitwise/shift assignments and unshadowed `Math.imul(a, b)`.
- Number-only ordered comparisons `<`, `<=`, `>`, `>=`; strict `===` and `!==` between numeric/boolean values; `!` and conditions with JS numeric/boolean truthiness.
- `if`/`else`, `while`, and `for`, including nested loops and early function returns. Break/continue are not implemented.
- Top-level synchronous function declarations, exact-arity direct calls, recursion and mutual recursion. Every function path must explicitly return a value; proof of termination or constant conditions is not attempted.
- Unshadowed `Porffor.argumentCount()` and `Porffor.argumentNumber(index)` for numeric CLI inputs; see the [precise contract](wasip3-command.md#numeric-command-arguments).
- Exactly one number/boolean argument to unshadowed `console.log`, used as a statement. Printing is an explicit fixed runtime capability.

Numbers remain IEEE binary64. `2147483647 + 1` yields `2147483648`, not signed i32 overflow. Booleans remain a distinct semantic category; lowered i32 0/1 is a representation choice. Unary minus and identity preserve signed zero. Truthiness treats either zero sign and NaN as false; infinities are true. Strict equality does not equate `true` with `1`.

## Type and effect restrictions

The program is closed: no exports, dynamic JavaScript values, mutable function bindings or captured outer variables. Binding analysis is reused for lexical identity, but its legacy optimization/type facts are not trusted as the new representation proof. The new lowering pass imposes number requirements on numeric operations and unifies representation constraints across block arguments and direct calls. Boolean literals flowing into numeric-only operations cause an error; no JS coercion is silently substituted. Function signatures and CFG merges must be monomorphic. Unresolved signatures are rejected, including unused generic identity functions with no call-site evidence.

This pass supports only the number/boolean specialization of the semantic operations. `JsAdd` still denotes JS addition in the semantic vocabulary; a later dynamic lowering will handle strings/coercion. The current frontend cannot construct those dynamic inputs. Calling the specialized lowered function externally requires its validated f64/i32 signature; this is not a general exported JS function ABI.

All instructions retain source order. Calls may print; nothing is reordered across them. `PrintNumber(f64)` and `PrintBoolean(i32)` are fixed void intrinsics with host-write effects registered in `intrinsics.mjs`. There is no arbitrary import name or embedded source field. Future memory/throw/suspend effects need additional checked contracts before optimization or runtime migration.

## Explicitly unsupported

TypeScript annotations (especially i32), integer-width specialization, var hoisting, undefined/uninitialized values, union-typed joins/calls, implicit function returns, closures, function values, dynamic/member calls other than console.log, Math.imul and the numeric argument API, objects/arrays/strings, coercive arithmetic/equality, logical/conditional expressions, break/continue, exceptions, async, generators, modules and other host APIs.

Automatic integer-width specialization and TypeScript integer annotations remain outstanding Phase 2 work; explicit standard JavaScript integer operations now lower to i32/u32. The IR schema already contains integer operations, but this frontend does not manufacture machine-integer arithmetic by truncating ordinary JS Numbers. A typed integer extension needs an explicit overflow/conversion contract and its own differential evidence. Full frontend source spans and richer diagnostics also remain future work.

## Validation and known reference discrepancy

The tests check both validators, nonmutation during lowering, block-argument types and scope behavior. The test interpreter uses a step budget to stop accidental nontermination. Differential cases compare independent expected values with Node, lowered IR, directly emitted Wasm and generated C compiled by Clang 19 at `-O0`.

One named regression case is deliberately tracked separately: the original C backend mishandles mutable operands in `x += (x = 5)` and `(x = 2) + (x = 3)`. Node and the new IR path agree on correct values; the C result is asserted against its explicitly recorded baseline, not accepted as equivalent. See the [work log](phase-2-work-log.md) for the reproduction. No tests are skipped for this discrepancy.

The existing `scripts/baseline.mjs` and foundation CI job include the new unit and differential suites. Native baseline build, upstream parity, and the pinned Test262 harness remain required checks. Direct core-Wasm emission is now implemented for this validated subset; remaining Phase 2 language extensions are still outstanding. Minimal WASI 0.3 command packaging is now implemented separately in Phase 4.

Phase 5 adds opt-in [boxed primitive compilation](primitive-values.md). Rebuild the wrapper before packaging it; null/undefined gain fixed print appenders while the WIT and stdout buffering contract remain unchanged. The component baseline also includes the boxed-value suite.

The subsequent [string increment](string-values.md) extends `--primitives` with UTF-16 strings and a separate bounded arena. Rebuild the command wrapper for its typed string capabilities; the WIT is unchanged.
