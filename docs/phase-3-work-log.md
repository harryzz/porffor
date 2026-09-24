# Phase 3 work log — minimal direct core Wasm

Date: 2026-09-23. This follows the validated Phase 2 integer increment and the user's instruction to proceed to the next step. Work stays on `js2wasip3/ir-foundation`; production compilation remains the existing C pipeline.

## Step 1 — scope and contracts

Read the project brief, existing IR schema, integer semantics, test fixtures and backend stub. No AGENTS.md was present. Inspected the dirty worktree and preserved the existing uncommitted foundation work. Checked the official WebAssembly instruction and module encoding references linked in [core-wasm.md](core-wasm.md).

The milestone is core Wasm for the supported numeric subset. Use only two fixed print imports. TypeScript annotations, dynamic runtime features and WASI/component packaging remain outside this increment.

## Step 2 — direct encoding

Implemented `emitCoreWasm` in `compiler/backends/wasm/index.mjs` with signed/unsigned LEB encoding, little-endian f64 literals, sections, signature interning, function indices, exports and function names. Support the existing scalar lowered operations for i32/u32/i64/u64/f64; reject opaque runtime representations. The function validates input and returns bytes without mutating the module.

Control flow uses local slots and a dispatcher loop for arbitrary validated CFGs. Edge arguments are assigned simultaneously. Direct calls and returns preserve signatures and evaluation order, including recursion and void calls.

## Step 3 — integer semantics inside Wasm

Added a private core-Wasm helper for JS modulo float-to-integer conversion using the binary64 exponent and significand. No JS conversion import or trapping/saturating conversion is used. Signed and unsigned interpretation occurs at typed consumer operations. Existing integer tests now execute both the IR interpreter and emitted Wasm.

## Step 4 — runnable artifacts and tests

Added `scripts/compile-wasm.mjs` and `scripts/run-numeric-wasm.mjs`. The first writes validated core Wasm; the second provides print imports and invokes main. Added [backend/host documentation](core-wasm.md).

Added 46 backend tests, including all 33 existing source fixtures, scalar-width checks, 16,384 float bit patterns against independent BigInt conversion expectations, parallel argument swaps, irreducible CFGs, multi-byte local/function indices, function names, print import/effect behavior, input rejection and CLI execution. All 46 passed on the first targeted run. The existing 149 unit tests also passed with Wasm execution added to the integer suite.

Expanded all 33 Node/C/IR differential tests with direct Wasm execution. Updated the baseline/CI entrypoint to include the backend tests, and regenerated the coupling inventory. Full baseline results are recorded below after completion.

AI disclosure: OpenAI Codex authored and tested this increment. No remote issue, PR, message or push was submitted.

## Step 5 — final verification

`node scripts/baseline.mjs` exited **0**. Full local logs: `/tmp/js2wasi-baseline-LmGv6o/` (temporary artifacts).

| Check | Result |
| --- | --- |
| Original compiler native build | Passed |
| 11 upstream parity cases and compiler self-compilation | Passed |
| Pinned Test262 harness | Expected baseline retained: 107/116 |
| Native arithmetic/loop smoke | Passed: 42 and 45 |
| IR, pipeline, integer and Wasm backend suites | 195 passed |
| Node / C / IR / Wasm differential suite | 33 passed |
| Total tests | **228 passed, zero failures/skips** |
| Coupling inventory check | Passed |
| New module/CLI syntax checks | Passed |

Standalone examples compiled and executed successfully: `/tmp/phase3-add.wasm` (192 bytes, output 42), `/tmp/phase3-sum.wasm` (281 bytes, output 45), and `/tmp/phase3-integers.wasm` (484 bytes, outputs 4294967295, -2, 48). These temporary files can be reproduced with the documented commands.

Verified production compiler, builtins, runtime, selfhost sources and original release workflow remain unchanged from upstream `8f015414`. Work remains local and uncommitted; no push or remote CI run occurred. The known C evaluation-order discrepancy is unchanged and explicitly asserted; Wasm matches the correct Node/IR results.

The minimal numeric core-Wasm milestone is complete. The next brief milestone is Phase 4: package a minimal WASI 0.3 command component with pinned tooling and validate it under an appropriate Wasmtime runtime. That packaging/runtime integration is not implemented by this increment.

Continuation: [Phase 4 work log](phase-4-work-log.md) records the subsequent command-component implementation. The statements above describe completion of Phase 3.
