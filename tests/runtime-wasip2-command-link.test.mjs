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
import { root, tool } from '../scripts/phase4-toolchain.mjs';
import { closureCases } from './helpers/closure-cases.mjs';

test('statically linked Rust driver and runtime run primitives, heap values and closures', t => {
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
      ['array retention across collection', 'const keep = [7]; for (let i = 0; i < 12000; i++) { const garbage = [i, i + 1]; } console.log(keep[0]);', '7\n', 262144],
      ['object allocation, property update and read', 'const item = { value: 7 }; item.value = 40; console.log(item.value + 2);', '42\n', undefined],
      ['nested object and array retention across collection', 'const keep = { child: { value: 7 } }; for (let i = 0; i < 12000; i++) { const garbage = { payload: [i, i + 1] }; } console.log(keep.child.value);', '7\n', 262144],
      ['closure capture and indirect invocation', 'const base = 40; const add = x => base + x; console.log(add(2));', '42\n', undefined],
      ['closure environment retention across collection', 'const captured = [7]; const get = () => captured[0]; for (let i = 0; i < 12000; i++) { const garbage = { payload: [i, i + 1] }; } console.log(get());', '7\n', 262144],
      ['computed captured string retained across collection', 'function make(){const word="hello" + " world";return ()=>word;}const get=make();for(let i=0;i<12000;i++){let garbage="g="+i;}console.log(get());', 'hello world\n', 262144],
      ['shipped command argument example', fs.readFileSync(path.join(root, 'examples/numeric/arguments.js'), 'utf8'), '42\n', undefined, ['20', '22']],
      ['shipped Uint8Array example', fs.readFileSync(path.join(root, 'examples/arrays/values.js'), 'utf8'), '3\nupdated\ntwo\n4\n1\n255\n', undefined]
    ];
    cases.push(...closureCases.map(({ name, source, expected }) => {
      const stressedSource = source.replaceAll('i<400', 'i<12000');
      const heapBytes = name.includes('collection') ? 262144 : undefined;
      return [`closure fixture: ${name}`, stressedSource, `${expected.map(String).join('\n')}\n`, heapBytes];
    }));
    for (const [name, program, expected, stringHeapBytes, commandArgs = []] of cases) {
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
      const output = execFileSync(wasmtime, ['run', component, ...commandArgs], { encoding: 'utf8' });
      assert.equal(output, expected, name);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
