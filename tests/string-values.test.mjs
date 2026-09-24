import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSemantic} from '../compiler/ir-v2/frontend.mjs';
import {lowerPrimitives} from '../compiler/ir-v2/lower-primitives.mjs';
import {emitCoreWasm} from '../compiler/backends/wasm/index.mjs';
import * as L from '../compiler/ir-v2/lowered.mjs';
import {coreHost} from '../scripts/core-host.mjs';
import {executeWasm} from './helpers/execute-wasm.mjs';
import {executeLowered} from './helpers/execute-lowered.mjs';
import {stringCases} from './helpers/string-cases.mjs';
import {VALUE_STRING,STRING_HEAP_BYTES} from '../compiler/runtime-v2/value-layout.mjs';
const compile=s=>lowerPrimitives(buildSemantic(s,{dynamic:true}));
for(const c of stringCases)test(`UTF-16 core strings: ${c.name}`,()=>{
  const m=compile(c.source);
  assert.deepEqual(executeLowered(m),c.expected);
  assert.deepEqual(executeWasm(m),c.expected);
});
const fixture=()=>L.module('lowered',[
  L.func('literal',[],'jsval','entry',[L.block('entry',[],[L.instruction('s','ValueString','jsval',[],{value:'ab'})],L.returnValue('s'))]),
  L.func('length',[L.parameter('s','jsval')],'f64','entry',[L.block('entry',[],[L.instruction('n','StringLength','f64',['s'])],L.returnValue('n'))]),
  L.func('concat',[L.parameter('a','jsval'),L.parameter('b','jsval')],'jsval','entry',[L.block('entry',[],[L.instruction('s','ValueAdd','jsval',['a','b'])],L.returnValue('s'))])
]);
function instance(mod=fixture(),host=coreHost(),options={}){
  const bytes=emitCoreWasm(mod,options);assert.ok(WebAssembly.validate(bytes));
  return {exports:new WebAssembly.Instance(new WebAssembly.Module(bytes),{porffor:host}).exports,host};
}
function runSmall(source,stringHeapBytes=4096){
  const output=[],host=coreHost([],x=>output.push(x));
  const {exports}=instance(compile(source),host,{stringHeapBytes});exports.main();return output;
}
test('tag, stable literal cache and UTF-16 layout match the declared ABI',()=>{
  const {exports:e,host}=instance();const value=e.literal(),pointer=Number(BigInt.asUintN(32,value));
  assert.equal(BigInt.asUintN(64,value)&0xffffffff00000000n,VALUE_STRING);
  const view=new DataView(host.memory.buffer);
  assert.equal(view.getUint32(pointer,true),2);assert.equal(view.getUint16(pointer+4,true),97);assert.equal(view.getUint16(pointer+6,true),98);
  for(let i=0;i<10000;i++)assert.equal(e.literal(),value);
  const copy=e.concat(value,value);assert.equal(e.length(copy),4);assert.equal(e.length(value),2);
});
test('unrecoverable live-set exhaustion traps and retains existing strings',()=>{
  const {exports:e,host}=instance();const original=e.literal();let s=original;
  assert.throws(()=>{for(let i=0;i<30;i++)s=e.concat(s,s);},WebAssembly.RuntimeError);
  assert.equal(e.length(original),2);
  assert.throws(()=>e.concat(s,s),WebAssembly.RuntimeError);
  assert.equal(e.length(original),2);assert.ok(host.memory.buffer.byteLength>=STRING_HEAP_BYTES);
});
test('mark-sweep repeatedly reclaims unreachable strings in a small arena',()=>{
  assert.deepEqual(runSmall('let keep="alive"+"!";for(let i=0;i<500;i++){let garbage="garbage="+i;}console.log(keep);'),['alive!']);
});
test('shadow roots preserve strings through calls, recursion and repeated collections',()=>{
  const source='function f(n,s){let keep=s+"x";for(let i=0;i<120;i++){let garbage="trash="+i;}if(n===0)return keep;let result=f(n-1,keep);console.log(keep.length);return result;}console.log(f(4,"a"));';
  assert.deepEqual(runSmall(source,16384),[5,4,3,2,'axxxxx']);
});
test('loop and parallel-edge roots survive collection pressure',()=>{
  const source='let a="left";let b="right";for(let i=0;i<400;i++){let old=a;a=b;b=old;let garbage="discard="+i;}console.log(a);console.log(b);';
  assert.deepEqual(runSmall(source,8192),['left','right']);
});
test('invalid pointers, alignment, reserved tag bits and corrupt lengths trap',()=>{
  const {exports:e,host}=instance();const value=e.literal(),base=Number(BigInt.asUintN(32,value));
  for(const pointer of [0,base+1,base+STRING_HEAP_BYTES-4,0xfffffff8])assert.throws(()=>e.length(VALUE_STRING|BigInt(pointer)),WebAssembly.RuntimeError);
  assert.throws(()=>e.length(VALUE_STRING|(1n<<32n)|BigInt(base)),WebAssembly.RuntimeError);
  const view=new DataView(host.memory.buffer);view.setUint32(base,0xffffffff,true);
  assert.throws(()=>e.length(value),WebAssembly.RuntimeError);
});
test('a rejected heap base never becomes trusted on a subsequent call',()=>{
  for(const base of [0,7,0xfffffff8]){
    const host=coreHost();host.string_heap_base=()=>base;
    const {exports:e}=instance(fixture(),host);
    assert.throws(()=>e.literal(),WebAssembly.RuntimeError);assert.throws(()=>e.literal(),WebAssembly.RuntimeError);
  }
  const host=coreHost();Object.defineProperty(host,'memory',{value:new WebAssembly.Memory({initial:1})});
  const {exports:e}=instance(fixture(),host);assert.throws(()=>e.literal(),WebAssembly.RuntimeError);
});
test('instances own disjoint arenas and cached literals survive unrelated allocations',()=>{
  const a=instance(),b=instance();const sa=a.exports.literal(),sb=b.exports.literal();
  new DataView(a.host.memory.buffer).setUint16(Number(BigInt.asUintN(32,sa))+4,120,true);
  assert.equal(new DataView(b.host.memory.buffer).getUint16(Number(BigInt.asUintN(32,sb))+4,true),97);
});
test('large literals use multi-byte offsets and keep embedded NUL and surrogates',()=>{
  const value='a'.repeat(20000)+'\0\ud800😀';
  assert.deepEqual(executeWasm(compile(`let s=${JSON.stringify(value)};console.log(s.length);console.log(s);`)),[value.length,value]);
});
test('oversized literals are rejected before emission',()=>{
  const m=fixture();m.functions[0].blocks[0].instructions[0].value='x'.repeat(STRING_HEAP_BYTES/2);
  assert.throws(()=>emitCoreWasm(m),/exceeds the bounded heap/);
});
test('string operation signatures reject malformed values and types',()=>{
  const m=fixture();m.functions[0].blocks[0].instructions[0].value=1;assert.throws(()=>L.validate(m),/invalid literal/);
  const n=fixture();n.functions[1].params[0].type='i32';assert.throws(()=>L.validate(n),/argument type/);
});
test('fixed computed length uses the property path',()=>assert.deepEqual(executeWasm(compile('console.log("s"["length"]);')),[1]));
for(const source of ['console.log(+"2");','console.log("2"*3);','console.log("a"<"b");','function f(x){return x-1;}console.log(f("2"));','let x="a";if(true)x=2;console.log(x.length);','console.log(null.length);','console.log("s".charAt(0));','console.log(Porffor.argumentNumber("0"));'])
  test(`reject unsupported string use: ${source}`,()=>assert.throws(()=>compile(source)));
