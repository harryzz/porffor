import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { executeLowered as interpret } from './helpers/execute-lowered.mjs';
import { executeWasm } from './helpers/execute-wasm.mjs';
const executeLowered = mod => {
  const expected = interpret(mod);
  assert.deepEqual(executeWasm(mod), expected, 'Wasm integer semantics agree');
  return expected;
};
import * as L from '../compiler/ir-v2/lowered.mjs';
const compile = source => lowerSemantic(buildSemantic(source));

test('integer operations have explicit conversions and typed operations', () => {
  const s = buildSemantic('console.log(Math.imul(7,3));console.log(-1>>>0);');
  assert.ok(s.functions[0].blocks[0].instructions.some(n => n.op === 'JsImul'));
  const ops = lowerSemantic(s).functions[0].blocks[0].instructions.map(n => n.op);
  for (const op of ['F64ToInt32','I32Multiply','I32ToF64','F64ToUint32','U32ShiftRight','U32ToF64']) assert.ok(ops.includes(op), op);
});

// Independently derive truncation/modulo expectations using BigInt on the exact
// represented integer, rather than using JS bitwise operators as the oracle.
const uint32 = x => !Number.isFinite(x) || x === 0 ? 0 : Number(BigInt.asUintN(32, BigInt(Math.trunc(x))));
const int32 = x => { const u = uint32(x); return u >= 2147483648 ? u - 4294967296 : u; };
const numbers = [0,-0,0.5,-0.5,3.9,-3.9,2147483647,2147483648,4294967295,4294967296,4294967297,-4294967297,9007199254740991,1e100,Number.MAX_VALUE,NaN,Infinity,-Infinity];
const literal = x => Number.isNaN(x) ? '(0/0)' : x === Infinity ? '(1/0)' : x === -Infinity ? '(-1/0)' : Object.is(x,-0) ? '(-0)' : String(x);
for (const x of numbers) test(`integer boundary ${literal(x)}`, () => {
  const src = `console.log(${literal(x)}|0);console.log(${literal(x)}>>>0);`;
  assert.deepEqual(executeLowered(compile(src)), [int32(x), uint32(x)]);
});
test('imul uses low 32 product bits over deterministic boundary pairs', () => {
  const finite = numbers.filter(Number.isFinite);
  const source = [], expected = [];
  for (const a of finite) for (const b of finite) {
    source.push(`console.log(Math.imul(${literal(a)},${literal(b)}));`);
    expected.push(Number(BigInt.asIntN(32, BigInt(uint32(a)) * BigInt(uint32(b)))));
  }
  assert.deepEqual(executeLowered(compile(source.join('\n'))), expected);
});
test('integer assignment and imul arguments capture operands before later writes', () => {
  assert.deepEqual(executeLowered(compile('let x=6;x&=(x=3);console.log(x);x=2;console.log(Math.imul(x++,x++));console.log(x);')), [2,6,4]);
});
for (const src of ['let Math=1;console.log(Math.imul(2,3));', 'console.log(Math.imul(1));', 'console.log(Math.imul(1,2,3));', 'console.log(Math.imul(true,2));', 'console.log(true|1);', 'console.log(Math.pow(2,3));', 'console.log(Math["imul"](2,3));']) {
  test(`reject unsupported integer source ${src}`, () => assert.throws(() => compile(src)));
}
for (const op of ['F64ToInt32', 'F64ToUint32', 'I32ToF64', 'U32ToF64', 'I32BitNot']) {
  test(`validator rejects wrong input type for ${op}`, () => {
    const expectedInput = op.startsWith('F64') ? 'f64' : op.startsWith('U32') ? 'u32' : 'i32';
    const wrongInput = expectedInput === 'f64' ? 'i32' : 'f64';
    const result = op === 'F64ToInt32' || op === 'I32BitNot' ? 'i32' : op === 'F64ToUint32' ? 'u32' : 'f64';
    const m = L.module('lowered',[L.func('f',[L.parameter('a',wrongInput)],result,'entry',[
      L.block('entry',[],[L.instruction('r',op,result,['a'])],L.returnValue('r'))
    ])]);
    assert.throws(() => L.validate(m), /argument type/);
  });
}
