import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { root, tool } from '../scripts/phase4-toolchain.mjs';

test('relocatable compiler output links with a Rust runtime object', () => {
  const wasmtime = tool('wasmtime');
  const wasmTools = tool('wasm-tools');
  const rustc = 'rustc';
  const rust = '+1.95.0';
  const sysroot = execFileSync(rustc, [rust, '--print', 'sysroot'], { encoding: 'utf8' }).trim();
  const host = execFileSync(rustc, [rust, '-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
  assert.ok(host, 'pinned rustc must report its host target');
  const linker = path.join(sysroot, 'lib/rustlib', host, 'bin/gcc-ld/wasm-ld');
  assert.ok(fs.existsSync(linker), `pinned Rust Wasm linker not found: ${linker}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porffor-runtime-object-link-'));
  try {
    const programObject = path.join(dir, 'program.o');
    const runtimeObject = path.join(dir, 'runtime.o');
    const linked = path.join(dir, 'linked.wasm');
    const source = buildSemantic('function twice(x) { return x * 2; } console.log(twice(21)); console.log("Hello");', { dynamic: true });
    fs.writeFileSync(programObject, emitCoreWasm(lowerPrimitives(source), { target: 'object' }));

    execFileSync(rustc, [rust, '--target', 'wasm32-unknown-unknown', '--crate-type=staticlib', '--emit=obj', '-C', 'opt-level=s', '-o', runtimeObject, path.join(root, 'tests/fixtures/runtime-object-link/runtime.rs')]);
    execFileSync(linker, ['--no-entry', '--initial-memory=8388608', '--export=runtime_invoke_and_last', '-o', linked, programObject, runtimeObject]);
    execFileSync(wasmTools, ['validate', linked]);
    const wat = execFileSync(wasmTools, ['print', linked], { encoding: 'utf8' });
    assert.doesNotMatch(wat, /^\s*\(import /m, 'runtime symbols should resolve in the linked core module');
    const output = execFileSync(wasmtime, ['run', '--invoke', 'runtime_invoke_and_last', linked], { encoding: 'utf8' });
    assert.equal(output.trim(), '47');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
