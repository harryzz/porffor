import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import * as L from '../compiler/ir-v2/lowered.mjs';
import { executeWasm } from './helpers/execute-wasm.mjs';
import { executeLowered } from './helpers/execute-lowered.mjs';
import { primitiveCases } from './helpers/primitive-cases.mjs';
import { cases } from './helpers/numeric-cases.mjs';
const compile=source=>lowerPrimitives(buildSemantic(source,{dynamic:true}));
const op=(name,paramTypes,result)=>L.module('lowered',[L.func('f',paramTypes.map((type,i)=>L.parameter(`p${i}`,type)),result,'entry',[
  L.block('entry',[],[L.instruction('r',name,result,paramTypes.map((_,i)=>`p${i}`))],L.returnValue('r'))
])]);
const wasm=m=>{
  const bytes=emitCoreWasm(m);assert.ok(WebAssembly.validate(bytes));
  return new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
};
for(const c of [...primitiveCases,...cases]) test(`boxed primitive execution: ${c.name}`,()=>{
  const semantic=buildSemantic(c.source,{dynamic:true}),before=structuredClone(semantic);
  const lowered=lowerPrimitives(semantic);
  assert.deepEqual(semantic,before);
  assert.deepEqual(executeLowered(lowered),c.expected);
  assert.deepEqual(executeWasm(lowered),c.expected);
});
test('scalar tags match upstream packed values and NaNs cannot become tags',()=>{
  const boxNumber=wasm(op('ValueBoxNumber',['f64'],'jsval')).f;
  const boxBoolean=wasm(op('ValueBoxBoolean',['i32'],'jsval')).f;
  const view=new DataView(new ArrayBuffer(8));
  for(const value of [0,-0,1,-1,Number.MIN_VALUE,Number.MAX_VALUE,Infinity,-Infinity,NaN]) {
    view.setFloat64(0,value,true);
    const expected=Number.isNaN(value)?0x7ff8000000000000n:view.getBigUint64(0,true);
    assert.equal(BigInt.asUintN(64,boxNumber(value)),expected);
  }
  for(const bits of [0xfff8000000000000n,0xfff8100000000001n,0xfff8380000000000n,0xffffffffffffffffn,0x7ff0000000000001n]) {
    view.setBigUint64(0,bits,true);
    assert.equal(boxNumber(view.getFloat64(0,true)),0x7ff8000000000000n);
  }
  assert.equal(BigInt.asUintN(64,boxBoolean(0)),0xfff8100000000000n);
  for(const value of [1,-1,2,2147483647])assert.equal(BigInt.asUintN(64,boxBoolean(value)),0xfff8100000000001n);
  for(const [name,bits] of [['ValueNull',0xfff8380000000000n],['ValueUndefined',0xfff8000000000000n]])
    assert.equal(BigInt.asUintN(64,wasm(op(name,[],'jsval')).f()),bits);
});
test('strict equality and conversions cover the primitive cross product',()=>{
  const values=[undefined,null,false,true,0,-0,NaN,Infinity,-Infinity,1,-1,2.5];
  const pack=value=>{
    if(value===undefined)return 0xfff8000000000000n;
    if(value===null)return 0xfff8380000000000n;
    if(typeof value==='boolean')return 0xfff8100000000000n | (value?1n:0n);
    const v=new DataView(new ArrayBuffer(8));v.setFloat64(0,value,true);return v.getBigUint64(0,true);
  };
  const eq=wasm(op('ValueStrictEqual',['jsval','jsval'],'i32')).f;
  const truthy=wasm(op('ValueTruthy',['jsval'],'i32')).f;
  const number=wasm(op('ValueToNumber',['jsval'],'f64')).f;
  for(const a of values){
    assert.equal(truthy(pack(a)),a?1:0);
    assert.ok(Object.is(number(pack(a)),Number(a)));
    for(const b of values)assert.equal(eq(pack(a),pack(b)),a===b?1:0);
  }
});
test('unsupported tags and invalid boolean payloads trap instead of acquiring accidental semantics',()=>{
  for(const bits of [0xfff8100000000002n,0xfff8380000000001n,0xfffa180000000008n,0xffffffffffffffffn]){
    for(const [name,result] of [['ValueToNumber','f64'],['ValueTruthy','i32'],['ValueUnboxNumber','f64']])
      assert.throws(()=>wasm(op(name,['jsval'],result)).f(bits),WebAssembly.RuntimeError);
    assert.throws(()=>wasm(op('ValueStrictEqual',['jsval','jsval'],'i32')).f(bits,bits),WebAssembly.RuntimeError);
  }
});
test('numeric argument API checks boxed argument types',()=>{
  assert.deepEqual(executeWasm(compile('console.log(Porffor.argumentCount());console.log(Porffor.argumentNumber(0));'),['42']),[1,42]);
  assert.throws(()=>executeWasm(compile('console.log(Porffor.argumentNumber(true));'),['42']),WebAssembly.RuntimeError);
});
test('primitive IR still rejects mismatched representations and extra attributes',()=>{
  const m=op('ValueBoxNumber',['i32'],'jsval');
  assert.throws(()=>L.validate(m),/argument type/);
  const n=op('ValueNull',[],'jsval');n.functions[0].blocks[0].instructions[0].value=0;
  assert.throws(()=>L.validate(n),/expected fields/);
});
test('coercion and boxing emit no evaluation imports or memory',()=>{
  const m=compile('function f(x){return x+true;}f(null);');
  const module=new WebAssembly.Module(emitCoreWasm(m));
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert.ok(WebAssembly.Module.exports(module).every(e=>e.kind==='function'));
});
test('numeric mode remains strict and does not silently select dynamic lowering',()=>{
  assert.throws(()=>buildSemantic('console.log(null);'));
  assert.throws(()=>lowerSemantic(buildSemantic('let x=1;if(true)x=false;console.log(x);')));
});
for(const source of ['console.log({});','console.log([]);','console.log(/x/);','console.log(missing);','let x=x;','console.log(x);let x=1;','console.log(typeof 1);','console.log(1n);','function f(){return x;}let x=1;f();','let undefined=1;','const NaN=2;','function Infinity(){return 1;}'])
  test(`primitive mode rejects unsupported source: ${source}`,()=>assert.throws(()=>compile(source)));
