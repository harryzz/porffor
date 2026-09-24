import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSemantic} from '../compiler/ir-v2/frontend.mjs';
import {lowerPrimitives} from '../compiler/ir-v2/lower-primitives.mjs';
import {emitCoreWasm} from '../compiler/backends/wasm/index.mjs';
import {coreHost} from '../scripts/core-host.mjs';
import {executeLowered} from './helpers/execute-lowered.mjs';
import {objectCases} from './helpers/object-cases.mjs';
const compile=s=>lowerPrimitives(buildSemantic(s,{dynamic:true}));
function wasm(source,stringHeapBytes){const output=[],host=coreHost([],x=>output.push(x)),bytes=emitCoreWasm(compile(source),stringHeapBytes?{stringHeapBytes}:{});assert.ok(WebAssembly.validate(bytes));new WebAssembly.Instance(new WebAssembly.Module(bytes),{porffor:host}).exports.main();return output;}
for(const c of objectCases)test(`object core semantics: ${c.name}`,()=>{assert.deepEqual(executeLowered(compile(c.source)),c.expected);assert.deepEqual(wasm(c.source),c.expected);});
test('collector traces mutated object graphs and terminates on cycles',()=>{
 const source='let cycle={next:null};cycle.next=cycle;console.log(cycle);';
 assert.throws(()=>compile(source),/direct heap-value printing/);
 const executable='let cycle={next:null};cycle.next=cycle;console.log(cycle===cycle);';
 // Identity equality is deliberately rejected, so observe the cycle via a scalar property.
 const supported='let cycle={next:null,number:9};cycle.next=cycle;let holder={value:{text:"rooted"}};for(let i=0;i<500;i++){let garbage="garbage="+i;}console.log(cycle.number);console.log(holder.value.text);';
 assert.throws(()=>compile(executable),/identity equality/);assert.deepEqual(wasm(supported,16384),[9,'rooted']);
});
test('overflow property pages grow while preserving prior fields',()=>{
 let source='let o={};';for(let i=0;i<25;i++)source+=`o.k${i}=${i+1};`;
 source+='console.log(o.k0);console.log(o.k8);console.log(o.k24);';
 assert.deepEqual(wasm(source),[1,9,25]);
});
test('collector traces a prototype after its creating frame returns',()=>{
 const source='function make(){let proto={retained:"through-prototype"};return Object.create(proto);}let child=make();for(let i=0;i<500;i++){let garbage="garbage="+i;}console.log(child.retained);';
 assert.deepEqual(wasm(source,16384),['through-prototype']);
});
for(const source of ['console.log({a:1});','console.log({}==={});','console.log({}+"");','let key=1;let o={a:1};console.log(o[key]);','Object.create(1);','let Object={create:null};Object.create(null);','let o={get a(){return 1;}};','let o={...{a:1}};'])
 test(`reject unsupported object boundary: ${source}`,()=>assert.throws(()=>compile(source)));
