# Porffor native baseline

## Provenance and scope

The workspace initially contained only the engineering brief. A fresh local clone of https://github.com/CanadaHonk/porffor was created in `porffor/`, with clean upstream worktree at `8f01541498d6d61c0cbbf8a71be152330888be7e` (2026-09-17, `ci: npm publishing`). Work is on local branch `js2wasip3/ir-foundation`. No remote fork, publication, PR or commit was created. The original brief is preserved outside the clone.

No AGENTS.md was found in the checkout or its ancestor directories. README, IR, codegen, renderer, semantic analysis, promises, driver, selfhost build, test harness and CI were inspected before editing. History reviewed includes the July rewrite `785b15a7081fd7ebe8f3a2c1f516ad9704e3cb7d` and basic WASI change `21a8c46c579e7c574b9f192aea9e5b96955d31ee`. All production source and existing release CI remain unchanged.

AI disclosure: OpenAI Codex inspected the repository, authored the new experimental modules, tests, scripts, workflow and design documents, and ran the recorded checks. No upstream PR text or comments were generated or submitted. This disclosure follows the repository's AI_POLICY.md.

## Reproduce

Tested host: Debian GNU/Linux 13 (trixie), x86_64 Linux. Tools: Node **20.19.2**, Debian Clang **19.1.7**, package `1:19.1.7-3+b1`, system C headers/linker and Git. No npm dependencies are needed. The Swift-provided clang shim earlier in PATH crashed under the sandbox; commands explicitly select `/usr/bin/clang-19`.

From the clone root:

```sh
git clone https://github.com/tc39/test262.git test262/test262
git -C test262/test262 checkout 6eec1ac9ee144dafd8f344d73a21f36bfc9f6755
SELFHOST_CC=/usr/bin/clang-19 node scripts/baseline.mjs
```

Skip cloning if the pinned checkout already exists. The script verifies Node/Clang versions, Test262 revision and clean Test262 worktree; forces Node bundling and Clang compilation (disabling opportunistic Bun/TCC use), runs the existing selfhost build and parity checks, bounded harness tests, native stdout smoke, new IR and numeric pipeline tests, numeric differential tests and inventory drift check. Each subprocess has a timeout and a separate log under a newly created `/tmp/js2wasi-baseline-*` directory. No full Test262 conformance claim is made.

The new `ir-foundation.yaml` workflow runs the same script on pushes and PRs, independently of upstream release-author gating, and uploads logs. Node, Clang package and Test262 are pinned. The Debian base tag and transitive OS packages are not a hermetic image lock; if the exact compiler package disappears, setup intentionally fails pending a reviewed baseline update. This workflow has not yet run on GitHub. Existing CI uses Node 24, LLVM 21 and Zig 0.16.0 for release builds; this smaller job documents the separately verified development toolchain.

Upstream publishes Linux x64/arm64 (glibc and musl) and macOS x64/arm64. Only Linux x64 was tested here. Existing C-to-WASI compatibility is not a supported direct-Wasm/component target. Windows and other platforms were not validated.

## Recorded results, 2026-09-23

| Check | Result |
| --- | --- |
| `SELFHOST_CC=/usr/bin/clang-19 node selfhost compile --no-monitor` | Pass: bundle, stage1 C, native selfhost compiler; initial build approximately 40 seconds |
| `node selfhost verify --no-monitor` | Pass: all 11 cases (hello, exceptions, json_stringify, indirect, linked_list, bf, richards, v8_v7, string_methods, regex, temporal), plus stage2 compiler C byte parity |
| `CC=/usr/bin/clang-19 node test262/selfhost.js harness --threads=4 --expect-passes=107 --dont-write-results` | Pass against upstream expectation: **107/116**; 5 test failures, 3 runtime errors, 1 native compilation error; zero compiler errors and timeouts |
| Native arithmetic/loop smoke | Pass: emitted C compiled and executed; normalized stdout is `42` then `45` |
| IR construction and validation tests | Pass: 51 tests |
| Coupling inventory consistency | Pass: generated index matches the checked document |

Final end-to-end run: `node scripts/baseline.mjs` exited **0**. Logs are at `/tmp/js2wasi-baseline-Oo6XdD/` in this workspace session (temporary, not repository artifacts). The workflow YAML also parsed successfully locally; GitHub execution remains untested.

The nine Test262 failures are present on the unchanged upstream compiler, matching the existing release job's 107-pass expectation. They are not reclassified as successes or fixed in this milestone. The upstream pass-count assertion does not fingerprint the identities of failures; future migrations should add per-test differential manifests, particularly before changing semantics. Parity compares emitted C; it does not execute every benchmark. A separate arithmetic/loop native stdout smoke checks `42` and `45` in the reproducibility script after stripping Porffor's ANSI color formatting; the raw stdout is saved as a log.

Initial in-sandbox native execution failed (`writeFileSync failed`, or the runner classified the native compiler as not runnable). Retrying outside the sandbox succeeded. Node subprocess enumeration also returned EPERM inside the sandbox. These environment failures are distinct from compiler regressions; the successful baseline uses approved unsandboxed execution.

Generated bundles, C and the native compiler remain in ignored `selfhosted/` paths. Test262 is an ignored pinned nested checkout; logs and smoke artifacts are temporary. No generated compiler outputs are committed.

## External facts rechecked

The [official WASI roadmap](https://wasi.dev/roadmap) reports WASI 0.3.0 shipped June 11, 2026, 0.3.1 in August, and Wasmtime 46+ support. It distinguishes async functions, futures and streams from the former wasi:io model. The [wasi-sdk releases](https://github.com/WebAssembly/wasi-sdk/releases) document the wasip3 target, including continuing ABI work; future packaging must pin and test a specific SDK rather than assume all releases are interchangeable. [Wasmtime 46.0.3](https://github.com/bytecodealliance/wasmtime/releases/tag/v46.0.3) exists as a patched 46-series release. None of these toolchains was installed or exercised by this native-only milestone.

Porffor's local source confirms JS/TS -> mixed IR -> C, custom tracing GC and limited C/WASI guards. WasmGC is independent of WASI 0.3 and does not replace JS semantics. Component async and WasmGC implementation remain explicitly out of scope.

## Phase 2 extension

The recorded Phase 0/1 results above remain historical. The reproducibility script now also runs the numeric pipeline and differential suites; see [the Phase 2 work log](phase-2-work-log.md) for current results and the named C-backend evaluation-order discrepancy. Production compiler source is still unchanged.
