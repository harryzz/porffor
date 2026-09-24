// Prototype: componentize EH-bearing core Wasm with WIT metadata, then plug
// internal runtime/program/command components together without --adapt.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root, tool } from './phase4-toolchain.mjs';

const wasmTools = tool('wasm-tools');
const wasmtime = tool('wasmtime');
const wac = tool('wac');
const fixtures = path.join(root, 'tests/fixtures/direct-component');
const driver = path.join(fixtures, 'driver');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porffor-direct-component-'));
const cargoTarget = path.join(root, 'component-runtime/target/direct-component-probe-cargo');
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: 'pipe', ...options });

try {
  const programCore = path.join(dir, 'porffor-program-core.wasm');
  const runtimeCore = path.join(dir, 'porffor-runtime-core.wasm');
  const driverCore = path.join(dir, 'command-driver-core.wasm');
  const programComponent = path.join(dir, 'porffor-program.wasm');
  const runtimeComponent = path.join(dir, 'porffor-runtime.wasm');
  const driverComponent = path.join(dir, 'command-driver.wasm');
  const linkedProgram = path.join(dir, 'linked-program.wasm');
  const output = path.join(dir, 'command.wasm');

  run(wasmTools, ['component', 'embed', path.join(fixtures, 'porffor-program.wit'), path.join(fixtures, 'program.wat'), '-o', programCore]);
  run(wasmTools, ['component', 'new', programCore, '-o', programComponent]);
  run(wasmTools, ['component', 'embed', path.join(fixtures, 'runtime.wit'), path.join(fixtures, 'runtime-provider.wat'), '-o', runtimeCore]);
  run(wasmTools, ['component', 'new', runtimeCore, '-o', runtimeComponent]);

  run('cargo', ['+1.95.0', 'build', '--locked', '--manifest-path', path.join(driver, 'Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release', '--target-dir', cargoTarget]);
  const driverArtifact = path.join(cargoTarget, 'wasm32-unknown-unknown/release/porffor_direct_driver_probe.wasm');
  run(wasmTools, ['component', 'new', driverArtifact, '-o', driverComponent]);

  run(wac, ['plug', programComponent, '--plug', runtimeComponent, '-o', linkedProgram]);
  run(wac, ['plug', driverComponent, '--plug', linkedProgram, '-o', output]);
  run(wasmTools, ['validate', output]);
  const wit = run(wasmTools, ['component', 'wit', output], { encoding: 'utf8' });
  assert.match(wit, /export wasi:cli\/run@0\.3\.0/);
  assert.doesNotMatch(wit, /porffor:internal/);
  const printed = run(wasmTools, ['print', output], { encoding: 'utf8' });
  assert.match(printed, /\(tag .*param i64\)/);
  assert.match(printed, /try_table .*catch/);
  run(wasmtime, ['run', output]);
  console.log('Direct component probe passed: EH payload 42 caught across a call; only wasi:cli/run is exported.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
