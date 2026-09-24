// Packaging only: the numeric program is already a directly encoded core module.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runtimeWasm, tool } from '../../scripts/phase4-toolchain.mjs';

export function packageCommand(core) {
  if (!fs.existsSync(runtimeWasm)) throw new Error('Missing command runtime; run node scripts/build-component-runtime.mjs');
  const wasmTools = tool('wasm-tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porffor-command-'));
  try {
    const program = path.join(dir, 'program.wasm'), output = path.join(dir, 'command.wasm');
    fs.writeFileSync(program, core);
    // The adapter's __main_module__ imports bind to runtime core exports. Standard
    // component tooling owns canonical ABI wiring, trampolines and binary encoding.
    execFileSync(wasmTools, ['component', 'new', runtimeWasm, '--adapt', `porffor_program=${program}`, '-o', output], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    execFileSync(wasmTools, ['validate', output], { timeout: 30000 });
    return new Uint8Array(fs.readFileSync(output));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
