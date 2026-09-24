# Phase 2 work log

## Scope and sequence — 2026-09-23

Continue from the Phase 0/1 baseline and isolated IR skeleton on local branch `js2wasip3/ir-foundation`. Preserve the existing uncommitted work and production C backend. This task implements the first executable numeric slice through both IR layers; direct Wasm emission and component packaging remain subsequent phases.

1. Inspect parser/binding APIs and define the accepted language subset.
2. Build validated semantic CFGs from source.
3. Infer closed-program number/boolean types and lower to typed CFGs.
4. Execute lowered IR with a **test-only** interpreter and compare against Node and Porffor's native C backend.
5. Add reviewable IR dumps, examples, CI coverage and updated documentation; record actual checks and limitations here.

## Step 1 — inspection and decisions

- Confirmed production source is unchanged from baseline `8f01541498d6d61c0cbbf8a71be152330888be7e`; earlier skeleton files remain uncommitted.
- Reuse `compiler/parser/index.js` and `compiler/semantic.js`. Binding analysis attaches binding identities (`_variable` / `_resolvedVariable`), so block shadowing can use those identities rather than a second name resolver.
- The legacy analyzer expects `semantic.objectHackers`, normally set by codegen. The experimental adapter will temporarily set an empty list and restore it synchronously; the numeric subset has no builtin identifier rewriting or eval.
- JavaScript Number arithmetic lowers to f64, even for integer literals. Boolean values remain distinct semantic values and lower to i32. No silent i32 truncation or unchecked TypeScript annotation erasure.
- Restrict functions to top-level direct calls, fixed arity and explicit value returns. Reject captured variables, function values/reassignment, dynamic calls, var hoisting, objects, arrays, strings, exceptions and async.
- Preserve left-to-right evaluation and mutable locals using SSA values and explicit block arguments. No optimization or reordering is introduced.
- Printing is a fixed, typed runtime intrinsic, not an arbitrary native symbol or source escape. The interpreter is verification tooling only, not the compiler's final execution architecture.

## Step 2 — semantic frontend implemented

- Added `compiler/ir-v2/frontend.mjs`, reusing the existing parser and lexical binding identities. Generated IDs keep user names and legacy `#` shadow suffixes out of backend symbols.
- Added number/boolean expressions, initialized let/const, numeric assignments and updates, if/else, while/for, top-level functions and explicit returns. Conditions and call arguments retain source evaluation order.
- Branch and loop edges carry live environment values as block parameters; block/for scopes remove their declarations without discarding assignments to outer bindings.
- Syntax preflight rejects unsupported constructs even in dead source. Binding checks reject TDZ reads, captures, const writes, indirect calls and shadowed console output. Expressions cannot consume the void print intrinsic.
- Both supplied examples (ordinary JS spelling of add, and sum loop) now produce validated semantic CFGs. Explicit TypeScript integer annotations remain rejected pending a separately tested specialization policy.

## Step 3 — numeric lowering implemented

- Replaced the lowering stub with module-wide constraints across call signatures and block arguments. Conflicting number/boolean flows are rejected instead of miscompiled. Unknown signatures are diagnosed.
- Number operations become f64 operations; booleans become i32. Numeric truthiness handles both zero signs and NaN correctly. Strict equality keeps number and boolean distinct; operand evaluation is retained even when types prove equality false.
- Added fixed `PrintNumber` / `PrintBoolean` runtime intrinsics with typed signatures and host-write effects. There is no arbitrary C/native call escape. Instruction order is preserved.
- Lowering validates input and output and leaves the input semantic module unchanged.
- Initial validator/pipeline test run: **106 tests passed**, including loops, shadowing, recursion, early returns, signed zero, NaN, evaluation order and negative subset cases.

## Step 4 — equivalence validation setup

- Added a test-only lowered-CFG interpreter with a shared execution step budget. It is outside compiler/runtime paths and is not a substitute for future direct Wasm emission.
- Added 23 source cases, each checked against independent expected values, Node execution, and the unchanged Porffor JS -> C -> native path using Clang 19. Oracle output normalization removes ANSI color and recognizes nonfinite number spellings, while retaining signed zero and booleans.
- Added `scripts/compile-numeric.mjs` and two examples. Both examples successfully write validated semantic/lowered review dumps to a requested directory. Dumps use text inspection so signed zero, NaN and Infinity are not lost to JSON conversion.

### Differential finding: existing C-backend evaluation-order bug

The first differential run passed 22/23 cases and exposed a pre-existing mismatch in the unchanged production backend:

```js
let x = 1;
console.log(x++ + ++x); // all paths: 4
x = 1;
x += (x = 5);
console.log(x);         // Node/new IR: 6; legacy C: 10
console.log((x = 2) + (x = 3)); // Node/new IR: 5; legacy C: 6
console.log(x);         // all paths: 3
```

Reproduced separately with Clang 19 at `-O0`, with production codegen/render/semantic files verified unchanged from baseline. Reproduction artifacts: `/tmp/js2wasi-phase2-order/`. The new SSA frontend captures each operand before evaluating the next, preserving JavaScript order. The C renderer/codegen path rereads mutable values after later writes.

This case remains a mandatory test: Node and new IR must match the correct expected values; C must match the specifically recorded `[4, 10, 6, 3]` regression. It is not skipped, broadly tolerated or called equivalent. If the upstream behavior changes, its explicit regression assertion will fail for review. Fixing the retained C backend is a separate task.

## Step 4 — targeted validation complete

- Final targeted command: `node --test tests/ir-v2.test.mjs tests/numeric-pipeline.test.mjs tests/numeric-differential.test.mjs`.
- Result: **129 tests passed, zero failures/skips** (106 validator/pipeline tests plus 23 differential cases).
- Node and new IR agree on all 23 cases. C agrees on 22; the one named baseline evaluation-order discrepancy is asserted separately as documented above.
- Verified the legacy analyzer's temporary configuration is restored and repeated frontend compilations remain valid.
- Verified both example dump commands and JavaScript module syntax.

## Step 5 — integration and current boundaries

- Added [numeric-subset.md](numeric-subset.md) with commands, accepted syntax, representation contracts, diagnostics and explicit exclusions. Updated [ir-design.md](ir-design.md) to distinguish implemented lowering from remaining design work.
- Extended the existing baseline script/CI entrypoint with mandatory numeric pipeline and differential suites. Oracle compiler selection uses the same pinned Clang as the native baseline.
- Updated inventory enumeration to include pending non-ignored source files as well as tracked files, so committing these modules does not make the source index stale. Regenerated and checked the index.
- Full native baseline rerun completed successfully; results are recorded below.
- Direct Wasm emission remains unimplemented. Integer-width/TypeScript specialization, dynamic JS values, full IR source metadata and additional control flow remain outstanding; this is a completed first numeric slice, not a claim that every planned Phase 2 feature exists.

## Final verification — 2026-09-23

`node scripts/baseline.mjs` exited **0**. Complete logs: `/tmp/js2wasi-baseline-3TdGXx/` (temporary local artifacts).

| Check | Result |
| --- | --- |
| Original compiler native build | Passed |
| 11 upstream C parity cases plus compiler self-compilation | Passed |
| Pinned Test262 harness | Expected baseline retained: 107/116 |
| Original native arithmetic/loop smoke | Passed: 42 and 45 |
| IR validator and numeric frontend/lowering suites | 106 passed |
| Node / lowered IR / C differential suite | 23 passed; includes one explicitly tracked C regression |
| Coupling index regeneration check | Passed |
| Both example IR dump commands and module syntax checks | Passed |

Production compiler, runtime, builtins and original release workflow remain unchanged from the upstream baseline. New work is local and uncommitted; nothing was pushed. Foundation CI uses the validated script but has not run on GitHub.

AI disclosure: OpenAI Codex authored and tested this Phase 2 slice and its documentation. No upstream issue, PR or message was submitted.

Next work can proceed from these validated CFGs toward a minimal direct-Wasm emitter, while integer/TypeScript specialization remains a separately documented Phase 2 extension. Do not route the production compiler through this experimental subset or claim dynamic JS/WASI async support.

## Phase 2 — increment 2: integer operations (2026-09-23)

The earlier Step 1–5 headings describe substeps within the first numeric increment. The user's request for “step 2 phase 2” is tracked here as the second increment, addressing integer operations before any Wasm backend work.

1. **Contract:** choose standard JS bitwise/shift operations and Math.imul as explicit integer semantics. Ordinary arithmetic stays f64; custom TypeScript integer annotations are still deferred. Checked official ECMAScript conversion and imul definitions; see [integer semantics](phase-2-integer-semantics.md).
2. **Frontend/semantic IR:** add bitwise/shift expressions and assignments plus unshadowed, exact-arity Math.imul. Keep left-to-right operand evaluation and reject nonnumeric operands or unsupported member calls.
3. **Lowered IR:** add checked f64/i32/u32 conversions and integer bit/shift operations; use wrapping I32Multiply for imul, then convert results to Number. No production C code was changed.
4. **Validation:** add independently calculated BigInt conversion/product checks, malformed type checks and 10 differential integer fixtures. The first expanded run found test-maintenance errors: the new loop's hand-calculated expectation was corrected to 197, and an older test that assumed the add fixture was first now selects it by name. No new native-backend discrepancy was found in that initial run.
5. **Integration:** add `examples/numeric/integers.js`, successfully generate both IR dumps, document the contracts and extend the baseline/CI test command. Final validation results follow below.

### Increment 2 — final verification

`node scripts/baseline.mjs` exited **0**. Complete logs: `/tmp/js2wasi-baseline-WShLDJ/` (temporary local artifacts). The targeted expanded test run also passed independently.

| Check | Result |
| --- | --- |
| Original compiler native build | Passed |
| 11 upstream C parity cases plus compiler self-compilation | Passed |
| Pinned Test262 harness | Expected baseline retained: 107/116 |
| Original native arithmetic/loop smoke | Passed: 42 and 45 |
| IR validator, numeric pipeline and integer suites | 149 passed |
| Node / lowered IR / C differential suite | 33 passed |
| Total expanded tests | **182 passed; zero failures/skips** |
| Coupling index check, integer example dumps and module syntax | Passed |

All 10 new integer differential cases agree across Node, the lowered-IR interpreter and C. The previously documented C evaluation-order discrepancy remains explicitly asserted in its existing fixture; it is not a new regression or skipped test.

Production compiler, runtime, builtins and the original release workflow remain unchanged. Work remains local and uncommitted, with no push or GitHub CI run. OpenAI Codex authored and validated this increment.

This completes the second numeric increment. Direct Wasm emission is still a stub; TypeScript integer annotations and wider JavaScript support remain deferred. The next implementation step is a minimal direct-Wasm emitter for the validated numeric IR, including the documented integer conversion semantics.

Continuation: [Phase 3 work log](phase-3-work-log.md) records the subsequent direct core-Wasm implementation and validation. Statements above describe the status at completion of Phase 2.
