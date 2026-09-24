import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { executeLowered } from './helpers/execute-lowered.mjs';
import { executeWasm } from './helpers/execute-wasm.mjs';
import { argumentIntrinsics } from '../compiler/ir-v2/intrinsics.mjs';
import * as L from '../compiler/ir-v2/lowered.mjs';
const compile = source => lowerSemantic(buildSemantic(source));
const values = ['20', '  -2.5\t', '+.5e1', '-0', '1e309', '0x10', '', 'NaN', 'Infinity', '1_2', '1 2', '\u00a01', '5.', '\v6\f'];
const expected = [20, -2.5, 5, -0, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, 5, 6];
test('argument API uses typed host-read intrinsics and finite decimal values', () => {
  const m = compile('console.log(Porffor.argumentCount()); for(let i=0;i<Porffor.argumentCount();i++) console.log(Porffor.argumentNumber(i));');
  assert.deepEqual(executeWasm(m,values),[values.length,...expected]);
  assert.deepEqual(executeLowered(m,{arguments:values}),[values.length,...expected]);
  assert.deepEqual(argumentIntrinsics.ArgumentNumber.effects,['host-read']);
  assert.equal(m.functions[0].blocks[0].instructions[0].op,'ArgumentCount');
});
test('invalid argument indices return NaN, with empty argument lists supported', () => {
  const m = compile('console.log(Porffor.argumentCount());console.log(Porffor.argumentNumber(-1));console.log(Porffor.argumentNumber(.5));console.log(Porffor.argumentNumber(1/0));console.log(Porffor.argumentNumber(0/0));console.log(Porffor.argumentNumber(100));');
  assert.deepEqual(executeWasm(m),[0,NaN,NaN,NaN,NaN,NaN]);
});
for (const source of [
  'console.log(Porffor.argumentCount(1));', 'console.log(Porffor.argumentNumber());',
  'console.log(Porffor.argumentNumber(1,2));', 'console.log(Porffor.argumentNumber(true));',
  'let Porffor=1;console.log(Porffor.argumentCount());', 'console.log(Porffor["argumentCount"]());',
  'console.log(Porffor.unknown());'
]) test(`argument API rejects ${source}`,()=>assert.throws(()=>compile(source)));
test('backend targets select a fixed import namespace and reject unknown targets', () => {
  const m = compile('console.log(Porffor.argumentNumber(0));');
  for (const [target, name] of [['host','porffor'],['command-adapter','__main_module__']]) {
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(emitCoreWasm(m,{target})));
    assert.deepEqual(imports.map(x=>x.module),[name,name]);
  }
  assert.throws(()=>emitCoreWasm(m,{target:'arbitrary'}),/unsupported target/);
});
test('argument intrinsics reject malformed types and arity', () => {
  const m = L.module('lowered',[L.func('f',[],'f64','entry',[
    L.block('entry',[],[L.instruction('r','ArgumentNumber','f64',[])],L.returnValue('r'))
  ])]);
  assert.throws(()=>L.validate(m),/argument count/);
});
