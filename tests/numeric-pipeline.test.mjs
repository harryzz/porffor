import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { executeLowered } from './helpers/execute-lowered.mjs';
import { cases } from './helpers/numeric-cases.mjs';
import * as S from '../compiler/ir-v2/semantic.mjs';
import * as L from '../compiler/ir-v2/lowered.mjs';

for (const {name, source, expected} of cases) test(`numeric pipeline: ${name}`, () => {
  const semantic = buildSemantic(source), snapshot = structuredClone(semantic);
  const lowered = lowerSemantic(semantic);
  assert.deepEqual(semantic, snapshot, 'lowering must not mutate semantic IR');
  S.validate(semantic); L.validate(lowered);
  assert.deepEqual(executeLowered(lowered), expected);
});

test('stages preserve semantic operations, select f64, and model print explicitly', () => {
  const semantic = buildSemantic(cases.find(c => c.name === 'add').source);
  assert.equal(semantic.functions[0].blocks[0].instructions[0].op, 'JsAdd');
  const lowered = lowerSemantic(semantic);
  assert.equal(lowered.functions[0].blocks[0].instructions[0].op, 'F64Add');
  assert.equal(lowered.functions.at(-1).blocks[0].instructions.at(-1).op, 'PrintNumber');
});

for (const [source, pattern] of [
  ['console.log("hello");', /only number and boolean/],
  ['let a=[1];', /ArrayExpression/],
  ['let a={x:1};', /ObjectExpression/],
  ['var x=1;', /var is unsupported/],
  ['let x;', /initializer/],
  ['console.log(x);let x=1;', /uninitialized/],
  ['let x=1;{console.log(x);let x=2;}', /uninitialized/],
  ['const x=1;x=2;', /assignment to const/],
  ['let x=1;function f(){return x;}console.log(f());', /captured/],
  ['function f(){function g(){return 1;}return g();}', /top-level/],
  ['let f=(x)=>x;', /ArrowFunctionExpression/],
  ['function f(x){return x;}let g=f;', /unsupported binding/],
  ['function f(x){return x;}console.log(f());', /arity mismatch/],
  ['function f(x){if(x)return 1;}console.log(f(true));', /fall through/],
  ['console.log(1,2);', /exactly one/],
  ['let console=1;console.log(2);', /unshadowed/],
  ['console.log(1+true);', /incompatible/],
  ['let x=0;if(true)x=false;console.log(x);', /incompatible/],
  ['function f(x){return x;}console.log(f(1));console.log(f(true));', /incompatible/],
  ['function f(x){return x;}', /cannot infer/],
  ['async function f(){return 1;}', /synchronous/],
  ['for(let i=0;i<2;i++){break;}', /BreakStatement/],
  ['console.log(true&&false);', /LogicalExpression/],
  ['console.log(1==true);', /unsupported operator/],
  ['eval("1");', /direct function calls/],
  ['function f(){return 1;throw 2;}console.log(f());', /ThrowStatement/],
  ['console.log(console.log(1));', /only be used as a statement/],
  ['function f(){return 1;}f=2;', /unsupported binding/]
]) test(`reject unsupported source: ${source}`, () => {
  assert.throws(() => lowerSemantic(buildSemantic(source)), pattern);
});

test('TypeScript is rejected explicitly rather than erasing integer semantics', () => {
  assert.throws(() => buildSemantic('function f(x:i32):i32{return x+1;}'), SyntaxError);
});
test('test interpreter bounds runaway loops', () => {
  const lowered = lowerSemantic(buildSemantic('while(true){}'));
  assert.throws(() => executeLowered(lowered, { maxSteps: 25 }), /step budget/);
});
test('fresh lowering IDs cannot collide with caller-supplied IR IDs', () => {
  const semantic = S.module('semantic', [S.func('main', [], 'none', 'entry', [S.block('entry', [], [
    S.instruction('lower0', 'JsNumber', 'value', [], {value: 0}),
    S.instruction('lower1', 'JsNot', 'value', ['lower0']),
    S.instruction(null, 'JsPrint', 'none', ['lower1'])
  ], S.returnValue())])]);
  assert.deepEqual(executeLowered(lowerSemantic(semantic)), [true]);
});
