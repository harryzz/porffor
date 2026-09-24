import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../compiler/ir-v2/lowered.mjs';
import * as S from '../compiler/ir-v2/semantic.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';

const fixture = (layer = 'lowered') => {
  const semantic = layer === 'semantic', t = semantic ? 'value' : 'i32';
  return L.module(layer, [L.func('add', [L.parameter('a', t), L.parameter('b', t)], t, 'entry', [
    L.block('entry', [], [L.instruction('sum', semantic ? 'JsAdd' : 'I32Add', t, ['a', 'b'])], L.returnValue('sum'))
  ])]);
};
for (const [layer, validate] of [['lowered', L.validate], ['semantic', S.validate]]) {
  test(`${layer}: construct and validate addition`, () => {
    const mod = fixture(layer); assert.equal(validate(mod), mod);
  });
  for (const [label, mutate, message] of [
    ['missing terminator', f => { f.blocks[0].terminator = null; }, /missing terminator/],
    ['bad type', f => { f.blocks[0].instructions[0].type = 'double'; }, /invalid type/],
    ['unknown operation', f => { f.blocks[0].instructions[0].op = 'RawC'; }, /unknown operation/],
    ['source escape field', f => { f.blocks[0].instructions[0].code = 'return 0;'; }, /expected fields/],
    ['use before definition', f => { f.blocks[0].instructions[0].args[0] = 'sum'; }, /undefined/],
    ['wrong arity', f => { f.blocks[0].instructions[0].args.pop(); }, /argument count/],
    ['duplicate value', f => { f.blocks[0].instructions[0].id = 'a'; }, /duplicate value/],
    ['duplicate parameter', f => { f.params[1].id = 'a'; }, /duplicate value/],
    ['missing entry', f => { f.entry = 'missing'; }, /missing entry/],
    ['invalid edge', f => { f.blocks[0].terminator = L.branch('missing'); }, /invalid control-flow edge/],
    ['return mismatch', f => { f.result = 'none'; }, /void return/],
    ['malformed node', f => { f.blocks[0].instructions[0] = null; }, /malformed instruction/],
    ['unknown terminator', f => { f.blocks[0].terminator = { op: 'Yield' }; }, /unknown terminator/],
    ['duplicate block', f => { f.blocks.push(structuredClone(f.blocks[0])); }, /duplicate block/],
    ['unreachable block', f => { f.blocks.push(L.block('dead', [], [], L.returnValue('a'))); }, /unreachable/]
  ]) test(`${layer}: rejects ${label}`, () => {
    const mod = fixture(layer); mutate(mod.functions[0]); assert.throws(() => validate(mod), message);
  });
}

const loop = () => L.module('lowered', [L.func('count', [], 'i32', 'entry', [
  L.block('entry', [], [L.instruction('zero', 'I32Const', 'i32', [], { value: 0 })], L.branch('loop', ['zero'])),
  L.block('loop', [L.parameter('i', 'i32')], [
    L.instruction('one', 'I32Const', 'i32', [], { value: 1 }),
    L.instruction('ten', 'I32Const', 'i32', [], { value: 10 }),
    L.instruction('next', 'I32Add', 'i32', ['i', 'one']),
    L.instruction('again', 'I32LessThan', 'i32', ['next', 'ten'])
  ], L.conditionalBranch('again', 'loop', ['next'], 'exit', ['next'])),
  L.block('exit', [L.parameter('out', 'i32')], [], L.returnValue('out'))
])]);
test('loop backedge and exit block parameters', () => L.validate(loop()));
for (const [label, mutate, message] of [
  ['edge arity', m => { m.functions[0].blocks[0].terminator.args = []; }, /argument count/],
  ['nonlocal value', m => { m.functions[0].blocks[2].terminator.value = 'next'; }, /nonlocal/],
  ['condition type', m => { m.functions[0].blocks[1].instructions[3] = L.instruction('again', 'F64Const', 'f64', [], { value: 1 }); }, /condition type/],
  ['edge type', m => { m.functions[0].blocks[2].params[0].type = 'f64'; }, /argument type/],
  ['entry edge', m => { m.functions[0].blocks[0].terminator = L.branch('entry'); }, /branch to entry/]
]) test(`rejects ${label}`, () => { const m = loop(); mutate(m); assert.throws(() => L.validate(m), message); });

test('direct calls check declared signatures, including void calls', () => {
  const m = fixture();
  m.functions.push(L.func('caller', [], 'i32', 'start', [L.block('start', [], [
    L.instruction('x', 'I32Const', 'i32', [], { value: 20 }),
    L.instruction('y', 'I32Const', 'i32', [], { value: 22 }),
    L.instruction('answer', 'DirectCall', 'i32', ['x', 'y'], { callee: 'add' })
  ], L.returnValue('answer'))]));
  L.validate(m);
  const call = m.functions[1].blocks[0].instructions[2];
  call.type = 'f64'; assert.throws(() => L.validate(m), /call result/); call.type = 'i32';
  call.callee = 'missing'; assert.throws(() => L.validate(m), /unknown callee/);
  const v = L.module('lowered', [L.func('noop', [], 'none', 'start', [
    L.block('start', [], [], L.returnValue())
  ]), L.func('invoke', [], 'none', 'start', [L.block('start', [], [
    L.instruction(null, 'DirectCall', 'none', [], { callee: 'noop' })
  ], L.returnValue())])]);
  L.validate(v);
  v.functions[1].blocks[0].instructions[0].id = 'voidValue';
  assert.throws(() => L.validate(v), /void instruction/);
});

for (const [op, type, good, bad] of [
  ['I32Const', 'i32', -2147483648, 2147483648],
  ['U32Const', 'u32', 4294967295, -1],
  ['I64Const', 'i64', -(1n << 63n), 1n << 63n],
  ['U64Const', 'u64', (1n << 64n) - 1n, -1n],
  ['F64Const', 'f64', NaN, 'NaN']
]) test(`${op} literal validation`, () => {
  const m = L.module('lowered', [L.func('constant', [], type, 'entry', [L.block('entry', [], [
    L.instruction('x', op, type, [], { value: good })
  ], L.returnValue('x'))])]);
  L.validate(m); m.functions[0].blocks[0].instructions[0].value = bad;
  assert.throws(() => L.validate(m), /invalid literal/);
});
test('layer isolation and validated Wasm boundary', () => {
  assert.throws(() => S.validate(fixture()), /wrong IR layer/);
  assert.throws(() => L.validate(fixture('semantic')), /wrong IR layer/);
  assert.equal(lowerSemantic(fixture('semantic')).functions[0].result, 'f64');
  assert.throws(() => emitCoreWasm(fixture('semantic')), /wrong IR layer/);
  assert.equal(WebAssembly.validate(emitCoreWasm(fixture())), true);
});

test('sparse argument lists cannot hide undefined values', () => {
  const m = fixture(); m.functions[0].blocks[0].instructions[0].args = new Array(2);
  assert.throws(() => L.validate(m), /invalid identifier/);
});
test('operand and return types must match', () => {
  const m = fixture(); m.functions[0].params[0].type = 'f64';
  assert.throws(() => L.validate(m), /argument type/);
  m.functions[0].params[0].type = 'i32'; m.functions[0].result = 'f64';
  assert.throws(() => L.validate(m), /return type/);
});
test('duplicate functions and instructions after terminators are rejected', () => {
  const m = fixture(); m.functions.push(structuredClone(m.functions[0]));
  assert.throws(() => L.validate(m), /duplicate function/);
  m.functions.pop(); m.functions[0].blocks[0].instructions.push(L.returnValue('sum'));
  assert.throws(() => L.validate(m), /unknown operation/);
});
test('semantic literals and direct calls retain JS values', () => {
  const m = fixture('semantic');
  m.functions.push(S.func('caller', [], 'value', 'entry', [S.block('entry', [], [
    S.instruction('n', 'JsNumber', 'value', [], { value: -0 }),
    S.instruction('b', 'JsBoolean', 'value', [], { value: true }),
    S.instruction('r', 'JsDirectCall', 'value', ['n', 'b'], { callee: 'add' })
  ], S.returnValue('r'))]));
  S.validate(m);
  m.functions[1].blocks[0].instructions[1].value = 1;
  assert.throws(() => S.validate(m), /invalid literal/);
});
test('semantic branches use JS truthiness and explicit block arguments', () => {
  const m = S.module('semantic', [S.func('identity', [S.parameter('x', 'value')], 'value', 'entry', [
    S.block('entry', [], [], S.conditionalBranch('x', 'yes', ['x'], 'no', ['x'])),
    S.block('yes', [S.parameter('y', 'value')], [], S.returnValue('y')),
    S.block('no', [S.parameter('n', 'value')], [], S.returnValue('n'))
  ])]);
  S.validate(m);
});
test('reserved GC types and implicit host functions are rejected', () => {
  const m = fixture(); m.functions[0].params[0].type = 'gc-ref';
  assert.throws(() => L.validate(m), /invalid type/);
  m.functions[0].params[0].type = 'i32';
  m.functions[0].blocks[0].instructions[0] = L.instruction('sum', 'DirectCall', 'i32', [], { callee: 'printf' });
  assert.throws(() => L.validate(m), /unknown callee/);
});
