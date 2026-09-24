import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as L from '../compiler/ir-v2/lowered.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { executeWasm } from './helpers/execute-wasm.mjs';
import { cases } from './helpers/numeric-cases.mjs';

function instantiate(mod, imports = {}) {
  const bytes = emitCoreWasm(mod);
  assert.equal(WebAssembly.validate(bytes), true);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), imports).exports;
}
const one = (params, result, instructions, value = 'r') => L.module('lowered', [
  L.func('f', params, result, 'entry', [L.block('entry', [], instructions, L.returnValue(value))])
]);
const operation = (op, type, result = type, arity = 2) => one(
  ['a', 'b'].slice(0, arity).map(id => L.parameter(id, type)), result,
  [L.instruction('r', op, result, ['a', 'b'].slice(0, arity))]
);
for (const c of cases) test(`Wasm source fixture: ${c.name}`, () => {
  assert.deepEqual(executeWasm(lowerSemantic(buildSemantic(c.source))), c.expected);
});

for (const [prefix, type, bits, signed] of [
  ['I32', 'i32', 32, true], ['U32', 'u32', 32, false],
  ['I64', 'i64', 64, true], ['U64', 'u64', 64, false]
]) test(`${prefix} scalar arithmetic, comparisons and literal boundaries`, () => {
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = (1n << BigInt(bits - (signed ? 1 : 0))) - 1n;
  const samples = [min, max, 0n, 1n, 63n, 64n, 127n, 128n];
  const input = x => bits === 32 ? Number(x) : x;
  // JS's core Wasm API exposes signed i32/i64 bit patterns, even for IR unsigned types.
  const output = x => input(BigInt.asIntN(bits, x));
  for (const value of samples) {
    const f = instantiate(one([], type, [L.instruction('r', `${prefix}Const`, type, [], { value: input(value) })])).f;
    assert.equal(f(), output(value));
  }
  for (const [suffix, calculate] of [
    ['Add', (a,b) => a+b], ['Subtract', (a,b) => a-b], ['Multiply', (a,b) => a*b],
    ['Equal', (a,b) => a===b ? 1n : 0n], ['LessThan', (a,b) => a<b ? 1n : 0n]
  ]) {
    const comparison = suffix === 'Equal' || suffix === 'LessThan';
    const f = instantiate(operation(`${prefix}${suffix}`, type, comparison ? 'i32' : type)).f;
    for (const a of samples) for (const b of samples)
      assert.equal(f(input(a), input(b)), comparison ? Number(calculate(a,b)) : output(calculate(a,b)), `${suffix} ${a}, ${b}`);
  }
});

test('binary64 constants preserve signed zero, infinities and NaN', () => {
  for (const value of [0, -0, NaN, Infinity, -Infinity, Number.MIN_VALUE, Number.MAX_VALUE, Math.PI]) {
    const f = instantiate(one([], 'f64', [L.instruction('r', 'F64Const', 'f64', [], { value })])).f;
    assert.ok(Object.is(f(), value));
  }
});

test('binary64 conversions cover every exponent with independent BigInt modulo oracle', () => {
  const signed = instantiate(operation('F64ToInt32', 'f64', 'i32', 1)).f;
  const unsignedMod = one([L.parameter('x', 'f64')], 'f64', [
    L.instruction('u', 'F64ToUint32', 'u32', ['x']),
    L.instruction('r', 'U32ToF64', 'f64', ['u'])
  ]);
  const unsigned = instantiate(unsignedMod).f;
  const view = new DataView(new ArrayBuffer(8));
  // Fixed mantissas exercise bits on either side of the truncation and wrap boundary.
  for (let exponent = 0; exponent < 2048; exponent++) {
    for (const mantissa of [0n, 1n, 0xabcde12345678n, (1n<<52n)-1n]) {
      for (const sign of [0n, 1n]) {
        view.setBigUint64(0, (sign<<63n) | (BigInt(exponent)<<52n) | mantissa, true);
        const x = view.getFloat64(0, true);
        const integer = Number.isFinite(x) ? BigInt(Math.trunc(x)) : 0n;
        assert.equal(signed(x), Number(BigInt.asIntN(32, integer)), `signed ${x}`);
        assert.equal(unsigned(x), Number(BigInt.asUintN(32, integer)), `unsigned ${x}`);
      }
    }
  }
});

test('parallel block arguments swap values on self edges; entry need not be first', () => {
  const m = L.module('lowered', [L.func('f', [], 'i32', 'entry', [
    L.block('loop', [L.parameter('a','i32'),L.parameter('b','i32'),L.parameter('n','i32')], [
      L.instruction('one','I32Const','i32',[],{value:1}),
      L.instruction('next','I32Subtract','i32',['n','one'])
    ], L.conditionalBranch('n','loop',['b','a','next'],'exit',['a','b'])),
    L.block('entry',[],[
      L.instruction('x','I32Const','i32',[],{value:2}),
      L.instruction('y','I32Const','i32',[],{value:7}),
      L.instruction('count','I32Const','i32',[],{value:3})
    ],L.branch('loop',['x','y','count'])),
    L.block('exit',[L.parameter('first','i32'),L.parameter('second','i32')],[
      L.instruction('r','I32Subtract','i32',['first','second'])
    ],L.returnValue('r'))
  ])]);
  assert.equal(instantiate(m).f(),5);
});

test('dispatcher supports a loop with two entry blocks (irreducible CFG)', () => {
  const m = L.module('lowered',[L.func('f',[L.parameter('choose','i32')],'i32','entry',[
    L.block('entry',[],[L.instruction('zero','I32Const','i32',[],{value:0})],L.conditionalBranch('choose','a',['zero'],'b',['zero'])),
    ...['a','b'].map((name,i) => L.block(name,[L.parameter(`${name}_n`,'i32')],[
      L.instruction(`${name}_one`,'I32Const','i32',[],{value:1}),
      L.instruction(`${name}_limit`,'I32Const','i32',[],{value:5}),
      L.instruction(`${name}_next`,'I32Add','i32',[`${name}_n`,`${name}_one`]),
      L.instruction(`${name}_again`,'I32LessThan','i32',[`${name}_next`,`${name}_limit`])
    ],L.conditionalBranch(`${name}_again`, i ? 'a':'b',[`${name}_next`],'exit',[`${name}_next`]))),
    L.block('exit',[L.parameter('r','i32')],[],L.returnValue('r'))
  ])]);
  const {f} = instantiate(m);
  assert.equal(f(0),5); assert.equal(f(1),5);
});

test('only used print intrinsics are imported; void direct calls retain effects', () => {
  const m = L.module('lowered',[
    L.func('helper',[],'none','entry',[L.block('entry',[],[
      L.instruction('n','F64Const','f64',[],{value:42}),
      L.instruction(null,'PrintNumber','none',['n'])
    ],L.returnValue())]),
    L.func('main',[],'none','entry',[L.block('entry',[],[
      L.instruction(null,'DirectCall','none',[],{callee:'helper'})
    ],L.returnValue())])
  ]);
  const module = new WebAssembly.Module(emitCoreWasm(m));
  assert.deepEqual(WebAssembly.Module.imports(module),[{module:'porffor',name:'print_number',kind:'function'}]);
  assert.equal(WebAssembly.Module.customSections(module,'name').length,1);
  assert.deepEqual(executeWasm(m),[42]);
  assert.throws(() => new WebAssembly.Instance(module, {porffor:{}}), WebAssembly.LinkError);
  const error = new Error('print failure');
  const exports = instantiate(m, {porffor:{print_number:()=>{throw error;}}});
  assert.throws(() => exports.main(), e => e === error);
});

test('multi-byte section lengths, local and function indices; emission is deterministic and nonmutating', () => {
  const functions = Array.from({length:140},(_,i) => L.func(`f${i}`,[],'i32','entry',[L.block('entry',[],
    Array.from({length:140},(_,j)=>L.instruction(`v${j}`,'I32Const','i32',[],{value:j+i})),L.returnValue('v139'))]));
  functions.push(L.func('call',[],'i32','entry',[L.block('entry',[],[
    L.instruction('r','DirectCall','i32',[],{callee:'f139'})
  ],L.returnValue('r'))]));
  const m = L.module('lowered',functions), before = structuredClone(m);
  const first = emitCoreWasm(m);
  assert.deepEqual(emitCoreWasm(m), first);
  assert.deepEqual(m,before);
  assert.equal(instantiate(m).call(),278);
});

test('unsupported representations and malformed IR fail before emission', () => {
  for (const type of ['linear-ptr']) {
    const m = one([L.parameter('r',type)],type,[]);
    assert.throws(()=>emitCoreWasm(m), /unsupported representation/);
  }
  const m = operation('I32Add','i32');
  m.functions[0].blocks[0].instructions[0].args[1]='missing';
  assert.throws(()=>emitCoreWasm(m), /undefined/);
});

test('empty module has no hidden imports or exports', () => {
  const module = new WebAssembly.Module(emitCoreWasm(L.module('lowered',[])));
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert.deepEqual(WebAssembly.Module.exports(module),[]);
});

test('compile/run CLI emits a standalone core module and rejects unsupported source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'js2wasi-wasm-'));
  try {
    const output = path.join(dir,'out.wasm');
    execFileSync(process.execPath,['scripts/compile-wasm.mjs','examples/numeric/sum.js',output]);
    assert.equal(execFileSync(process.execPath,['scripts/run-numeric-wasm.mjs',output],{encoding:'utf8'}),'45\n');
    const invalid = path.join(dir,'invalid.js'), rejected = path.join(dir,'invalid.wasm');
    fs.writeFileSync(invalid,'console.log("unsupported");');
    const result = spawnSync(process.execPath,['scripts/compile-wasm.mjs',invalid,rejected],{encoding:'utf8'});
    assert.equal(result.status,1); assert.equal(fs.existsSync(rejected),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
