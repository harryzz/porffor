import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { root, tool } from '../scripts/phase4-toolchain.mjs';

test('compiler object statically links against the production Rust runtime archive', () => {
  const wasmtime = tool('wasmtime');
  const wasmTools = tool('wasm-tools');
  const rustc = 'rustc';
  const rust = '+1.95.0';
  const cargo = 'cargo';
  const sysroot = execFileSync(rustc, [rust, '--print', 'sysroot'], { encoding: 'utf8' }).trim();
  const host = execFileSync(rustc, [rust, '-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
  assert.ok(host, 'pinned rustc must report its host target');
  const linker = path.join(sysroot, 'lib/rustlib', host, 'bin/gcc-ld/wasm-ld');
  assert.ok(fs.existsSync(linker), `pinned Rust Wasm linker not found: ${linker}`);

  execFileSync(cargo, [rust, 'build', '--manifest-path', path.join(root, 'component-runtime/static-link/Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release', '--features', 'static-link']);
  const runtimeArchive = path.join(root, 'component-runtime/static-link/target/wasm32-unknown-unknown/release/libporffor_wasip3_runtime_archive.a');
  assert.ok(fs.existsSync(runtimeArchive), 'production Rust runtime static archive was built');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porffor-production-runtime-link-'));
  try {
    const programObject = path.join(dir, 'program.o');
    const linked = path.join(dir, 'linked.wasm');
    const source = buildSemantic('console.log(42); console.log("Hello");', { dynamic: true });
    fs.writeFileSync(programObject, emitCoreWasm(lowerPrimitives(source), { target: 'object' }));

    execFileSync(linker, ['--no-entry', '--initial-memory=8388608', '--export=main', '-o', linked, programObject, runtimeArchive]);
    execFileSync(wasmTools, ['validate', linked]);
    const wat = execFileSync(wasmTools, ['print', linked], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    assert.doesNotMatch(wat, /^\s*\(import /m, 'compiler runtime imports should resolve against the Rust archive');
    assert.match(wat, /\(memory \(;0;\) 128\)/, 'program and Rust runtime share the linked linear memory');
    execFileSync(wasmtime, ['run', '--invoke', 'main', linked]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
