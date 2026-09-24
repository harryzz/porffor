import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {buildSemantic} from '../compiler/ir-v2/frontend.mjs';
import {lowerPrimitives} from '../compiler/ir-v2/lower-primitives.mjs';
import {emitCoreWasm} from '../compiler/backends/wasm/index.mjs';
import {packageCommand} from '../compiler/components/package-command.mjs';
import {tool,root} from '../scripts/phase4-toolchain.mjs';
import {stringCases} from './helpers/string-cases.mjs';
const wasmTools=tool('wasm-tools'),wasmtime=tool('wasmtime');
const compile=s=>emitCoreWasm(lowerPrimitives(buildSemantic(s,{dynamic:true})),{target:'command-adapter'});
function withComponent(core,fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-string-command-'));try{const file=path.join(dir,'command.wasm');fs.writeFileSync(file,packageCommand(core));return fn(file);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
for(const c of stringCases)test(`WASI UTF-16 strings: ${c.name}`,()=>{
 withComponent(compile(c.source),file=>{
  const expected=Buffer.from(c.expected.map(x=>Object.is(x,-0)?'-0':String(x)).join('\n')+'\n','utf8').toString('utf8');
  assert.equal(execFileSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000}),expected);
 });
});
test('string component retains the command WIT and excludes custom host imports',()=>{
 withComponent(compile('console.log("hello");'),file=>{
  assert.equal(execFileSync(wasmTools,['component','wit',file],{encoding:'utf8'}),fs.readFileSync(path.join(root,'docs/command-world.wit'),'utf8'));
 });
});
test('real argument numbers concatenate with strings',()=>{
 withComponent(compile('console.log("value="+Porffor.argumentNumber(0));'),file=>{
  assert.equal(execFileSync(wasmtime,['run','--',file,'42'],{encoding:'utf8'}),'value=42\n');
 });
});
test('WASI arena exhaustion traps without flushing partial buffered output',()=>{
 withComponent(compile('console.log("before");let s="ab";for(let i=0;i<30;i++)s=s+s;console.log(s);'),file=>{
  const result=spawnSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,/unreachable/);assert.equal(result.stdout,'');
 });
});
test('WASI command reclaims unreachable strings while retaining live roots',()=>{
 withComponent(compile('let keep="component"+" root";for(let i=0;i<40000;i++){let garbage="discard="+i;}console.log(keep);'),file=>{
  assert.equal(execFileSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000}),'component root\n');
 });
});
test('runtime string boundary rejects pointers outside the dedicated arena',()=>{
 const core=execFileSync(wasmTools,['parse','-'],{input:'(module (import "__main_module__" "string_heap_base" (func $base (result i32))) (import "__main_module__" "print_string" (func $print (param i32 i32))) (func (export "main") call $base drop i32.const 0 i32.const 1 call $print))'});
 withComponent(core,file=>{
  const result=spawnSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,/unreachable/);assert.equal(result.stdout,'');
 });
});
test('runtime number formatter stays within its 64-unit capacity',()=>{
 const core=execFileSync(wasmTools,['parse','-'],{input:'(module (import "__main_module__" "string_heap_base" (func $base (result i32))) (import "__main_module__" "format_number" (func $format (param f64 i32) (result i32))) (func (export "main") f64.const 42 call $base i32.const 4194302 i32.add call $format drop))'});
 withComponent(core,file=>{
  const result=spawnSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,/unreachable/);
 });
});
