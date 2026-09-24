import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { root, tool } from '../scripts/phase4-toolchain.mjs';

test('compiler component-core target matches the declared WIT world', () => {
  const wasmTools = tool('wasm-tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porffor-direct-abi-'));
  try {
    const core = path.join(dir, 'program-core.wasm');
    const embedded = path.join(dir, 'program-embedded.wasm');
    const component = path.join(dir, 'program.component.wasm');
    const source = buildSemantic('console.log(42); console.log(true);');
    const bytes = emitCoreWasm(lowerSemantic(source), { target: 'component-core' });
    fs.writeFileSync(core, bytes);

    execFileSync(wasmTools, ['component', 'embed', path.join(root, 'compiler/components/command-program.wit'), core, '-o', embedded]);
    execFileSync(wasmTools, ['component', 'new', embedded, '-o', component]);
    execFileSync(wasmTools, ['validate', component]);
    const wit = execFileSync(wasmTools, ['component', 'wit', component], { encoding: 'utf8' });
    assert.match(wit, /import porffor:internal\/runtime@0\.1\.0/);
    assert.match(wit, /print-number: func\(value: f64\)/);
    assert.match(wit, /print-boolean: func\(value: s32\)/);
    assert.match(wit, /export main: func\(\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
