import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { packageLinkedCommand } from '../compiler/components/package-linked-command.mjs';
import { tool } from '../scripts/phase4-toolchain.mjs';

test('statically linked Rust driver and runtime run primitive, string and array programs', t => {
  const sysroot = execFileSync('rustc', ['+stable', '--print', 'sysroot'], { encoding: 'utf8' }).trim();
  const targetLibdir = path.join(sysroot, 'lib/rustlib/wasm32-wasip2/lib');
  if (!fs.existsSync(targetLibdir)) {
    t.skip('install the wasm32-wasip2 Rust standard library to run this integration test');
    return;
  }
  const wasmtime = tool('wasmtime');
  const wasmTools = tool('wasm-tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porffor-wasip2-static-command-'));
  try {
    const cases = [
      ['primitive and string output', 'console.log(42); console.log("Hello");', '42\nHello\n', undefined],
      ['array allocation, indexed mutation and length', 'const a = [1, 2, 3]; a[1] = 40; console.log(a[1] + 2); console.log(a.length);', '42\n3\n', undefined],
      ['array retention across collection', 'const keep = [7]; for (let i = 0; i < 12000; i++) { const garbage = [i, i + 1]; } console.log(keep[0]);', '7\n', 262144]
    ];
    for (const [name, program, expected, stringHeapBytes] of cases) {
      const component = path.join(dir, `${name.replaceAll(/[^a-z]+/gi, '-')}.wasm`);
      const source = buildSemantic(program, { dynamic: true });
      const object = emitCoreWasm(lowerPrimitives(source), {
        target: 'object',
        ...(stringHeapBytes === undefined ? {} : { stringHeapBytes })
      });
      fs.writeFileSync(component, packageLinkedCommand(object));
      execFileSync(wasmTools, ['validate', component]);
      const wit = execFileSync(wasmTools, ['component', 'wit', component], { encoding: 'utf8' });
      assert.match(wit, /export wasi:cli\/run@0\.3\.0;/, name);
      assert.doesNotMatch(wit, /^\s*export (?!wasi:cli\/run)/m, 'the command component should expose only wasi:cli/run');
      const output = execFileSync(wasmtime, ['run', component], { encoding: 'utf8' });
      assert.equal(output, expected, name);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
