# Phase 4 work log — WASI 0.3 command component

Date: 2026-09-23. User authorized the next phase after the direct core-Wasm milestone. Branch: `js2wasip3/ir-foundation`. Existing foundation work was uncommitted and preserved. No AGENTS.md was present in the prior repository inspection.

## Step 1 — inspect and pin the toolchain

Inspected the existing compiler, tool availability, command-world requirements and official package/tool sources. The installed Wasmtime was 46.0.0; selected patched 46.0.3, wasm-tools 1.252.0, Rust 1.95.0, and stable wasip3 0.8.0+wasi-0.3.0 bindings. Verified downloaded archive SHA-256 digests against the official release metadata. Added a local setup script, fixed version checks, Rust toolchain file and Cargo lockfile. All versions and reproducible commands are in [wasip3-command.md](wasip3-command.md).

## Step 2 — prove standard component linkage

A temporary prototype linked the already emitted numeric program as a core adapter to a fixed command runtime using `wasm-tools component new --adapt`. Its `__main_module__` imports resolve to the runtime's print exports; the runtime calls the program's main export. The first component ran under pinned Wasmtime and printed 42.

The command wrapper is a separately compiled Rust runtime with generated official WIT bindings. It is not a translation target for the IR or user program. The final packager accepts the directly emitted binary and invokes standard tools; there is no program WAT/C/Rust generation in the packaging path.

The first prototype build required an explicit async block around the bindings' awaitable future reader for `futures::join!`; this was corrected before integrating the runtime.

## Step 3 — command boundary and argument access

Added the component compiler/runner and a fixed `command-adapter` emitter target, preserving the default Node-host import namespace. Added `Porffor.argumentCount()` / `Porffor.argumentNumber(index)` as narrow numeric capabilities with semantic operations, typed host-read intrinsics and strict source validation. Implemented matching Node development-host and interpreter support.

The runtime reads WASI arguments once per command, excludes argv[0], formats numbers/booleans and buffers up to 16 MiB of stdout. On successful numeric return it writes via the actual WASI 0.3 stream/future interface and awaits completion. Output failure/overflow returns command error; a raw core trap propagates. Buffered output before a trap is not flushed. These limits are documented; no JS async/Promise integration is claimed.

The argument example received 20 and 22 from Wasmtime and printed 42. The integer example printed 4294967295, -2 and 48. Recorded the actual component interface in [command-world.wit](command-world.wit).

## Step 4 — tests and CI integration

Added 11 argument unit tests and 42 component tests: all 33 existing numeric fixtures, WIT identity, real command arguments, empty command, core trap, stdout failure, output-buffer overflow, malformed inputs and CLI use.

The first test run passed 51/53. Two assertions incorrectly expected a stderr message for command error results; pinned Wasmtime correctly returned exit 1 with empty stderr. Updated those assertions to verify exact status and stderr. Trap diagnostics remain independently checked. A review also made the ASCII whitespace set explicit in Rust and added a vertical-tab/form-feed argument case to keep the Node and WASI contracts identical.

The rebuilt component baseline passed all 53 tests. The unchanged 195 preexisting unit/backend tests also passed in an independent regression run. Added the new argument tests to the native baseline and a separate pinned WASI command CI job with log artifacts. Full native baseline results follow below when complete.

AI disclosure: OpenAI Codex authored and tested this increment. No remote issue, PR, message or push was submitted.

## Step 5 — final verification

Both baseline scripts exited **0**:

- Native/IR baseline logs: `/tmp/js2wasi-baseline-SDtrzU/`.
- Component baseline logs: `/tmp/js2wasi-component-baseline-OwL74l/`.

These are temporary local artifacts; both scripts reproduce the checks and record new log directories.

| Check | Result |
| --- | --- |
| Original native compiler build | Passed |
| 11 upstream parity cases and compiler self-compilation | Passed |
| Pinned Test262 harness | Expected baseline retained: 107/116 |
| Native arithmetic/loop smoke | Passed: 42 and 45 |
| IR, numeric, integer, Wasm and argument unit suites | 206 passed |
| Node / C / IR / core-Wasm differential suite | 33 passed |
| Real WASI component suite | 42 passed |
| Total distinct tests | **281 passed, zero failures/skips** |
| Component baseline alone | 53 passed (11 argument tests repeated plus 42 component tests) |
| Locked Rust runtime build and Wasm validation | Passed |
| WIT snapshot and stable WASI 0.3 identities | Passed |
| Coupling inventory check and new script syntax checks | Passed |

Final command artifacts were independently compiled and run: `/tmp/phase4-add-final.component.wasm` (119382 bytes, output 42), `/tmp/phase4-sum-final.component.wasm` (119477 bytes, output 45), and `/tmp/phase4-arguments-final.component.wasm` (119661 bytes, arguments 20 22 produce 42). The same argument source emitted as core Wasm also printed 42 through the Node development host. These artifact sizes describe this local pinned build, not a cross-directory reproducible-build guarantee.

Verified production compiler, builtins, runtime, selfhost sources and original release workflow remain unchanged from upstream `8f015414`. The tracked `.gitignore` change only excludes downloaded component tools. All implementation work remains local and uncommitted; nothing was pushed and GitHub CI has not been executed remotely. The previously documented original C evaluation-order discrepancy is unchanged.

Phase 4's minimal command milestone is complete: standard command world, real WASI 0.3 stdout/arguments, successful return, command-error and trap behavior, and pinned CI configuration. The next brief milestone is Phase 5: incrementally restore dynamic JS runtime features, beginning with an explicit value/heap representation and a small tested feature. TypeScript integer annotations, general JS async/Promise conversion, user-facing streams and WasmGC remain unimplemented.

Continuation: [Phase 5 work log](phase-5-work-log.md) records the first boxed primitive runtime increment. Phase 4 results above remain historical.
