import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, tool } from '../../scripts/phase4-toolchain.mjs';

const rust = '+stable';
const target = 'wasm32-wasip2';
const commandRun = '[async-lift]wasi:cli/run@0.3.0#run';
const commandCallback = `[callback]${commandRun}`;

function rustToolchainPath(rustc, args) {
  return execFileSync(rustc, [rust, ...args], { encoding: 'utf8' }).trim();
}

export function packageLinkedCommand(programObject) {
  const wasmTools = tool('wasm-tools');
  const rustc = 'rustc';
  const cargo = 'cargo';
  const sysroot = rustToolchainPath(rustc, ['--print', 'sysroot']);
  const host = rustToolchainPath(rustc, ['-vV']).match(/^host: (.+)$/m)?.[1];
  if (!host) throw new Error('stable rustc did not report its host target');
  const targetLibdir = path.join(sysroot, 'lib/rustlib', target, 'lib');
  const linker = path.join(sysroot, 'lib/rustlib', host, 'bin/gcc-ld/wasm-ld');
  if (!fs.existsSync(targetLibdir)) throw new Error('Install the wasm32-wasip2 Rust standard library for the stable toolchain');
  if (!fs.existsSync(linker)) throw new Error(`Rust Wasm linker not found: ${linker}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porffor-linked-command-'));
  try {
    const targetDir = path.join(root, 'component-runtime/static-link/target');
    const archive = path.join(targetDir, target, 'release/libporffor_wasip3_runtime_archive.a');
    const object = path.join(dir, 'program.o');
    const linkedCore = path.join(dir, 'command-core.wasm');
    const componentCore = path.join(dir, 'command-core-clean.wasm');
    const component = path.join(dir, 'command.component.wasm');
    fs.writeFileSync(object, programObject);
    execFileSync(cargo, [
      rust, 'build', '--locked', '--manifest-path', path.join(root, 'component-runtime/static-link/Cargo.toml'),
      '--target', target, '--release', '--features', 'static-link'
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CARGO_TARGET_DIR: targetDir } });
    if (!fs.existsSync(archive)) throw new Error('Rust command/runtime static archive was not produced');

    execFileSync(linker, [
      '--no-entry', '--initial-memory=8388608',
      `--export=${commandRun}`, `--export=${commandCallback}`,
      `--undefined=${commandRun}`, `--undefined=${commandCallback}`,
      '-L', path.join(targetLibdir, 'self-contained'), '-lc',
      '-o', linkedCore, object, archive
    ]);
    execFileSync(wasmTools, ['validate', linkedCore]);
    // wasm-ld merges Rust name subsections without adjusting their offsets.
    // Drop debug/name metadata while preserving the component-type WIT metadata.
    execFileSync(wasmTools, ['strip', '-d', '^\\.debug_|^name$', linkedCore, '-o', componentCore]);
    execFileSync(wasmTools, ['component', 'new', componentCore, '-o', component]);
    execFileSync(wasmTools, ['validate', component]);
    return new Uint8Array(fs.readFileSync(component));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
