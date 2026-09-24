import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSemantic} from '../compiler/ir-v2/frontend.mjs';
import {lowerPrimitives} from '../compiler/ir-v2/lower-primitives.mjs';
import {emitCoreWasm} from '../compiler/backends/wasm/index.mjs';
import {coreHost} from '../scripts/core-host.mjs';
import {executeLowered} from './helpers/execute-lowered.mjs';
import {arrayCases} from './helpers/array-cases.mjs';
const compile=s=>lowerPrimitives(buildSemantic(s,{dynamic:true}));
function wasm(source,stringHeapBytes){const output=[],host=coreHost([],x=>output.push(x)),bytes=emitCoreWasm(compile(source),stringHeapBytes?{stringHeapBytes}:{});assert.ok(WebAssembly.validate(bytes));new WebAssembly.Instance(new WebAssembly.Module(bytes),{porffor:host}).exports.main();return output;}
for(const c of arrayCases)test(`array core semantics: ${c.name}`,()=>{assert.deepEqual(executeLowered(compile(c.source)),c.expected);assert.deepEqual(wasm(c.source),c.expected);});
test('collector traces array children and terminates on cycles',()=>{
 const source='let a=[null];a[0]=a;let keep=["rooted"];for(let i=0;i<500;i++){let garbage="garbage="+i;}console.log(a.length);console.log(keep[0]);';
 assert.deepEqual(wasm(source,8192),[1,'rooted']);
});
for(const source of ['let a=[1];a[2]=3;','let a=[1];console.log(a["0"]);','console.log([1]);','console.log([1]=== [1]);','console.log([1]+"");','let a=[[1]];console.log(a[0][0]);','let a=new Uint8Array(-1);'])
 test(`reject or trap unsupported array boundary: ${source}`,()=>assert.throws(()=>{const m=compile(source);const bytes=emitCoreWasm(m);new WebAssembly.Instance(new WebAssembly.Module(bytes),{porffor:coreHost()}).exports.main();}));
