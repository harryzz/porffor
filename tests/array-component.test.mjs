import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildSemantic} from '../compiler/ir-v2/frontend.mjs';
import {lowerPrimitives} from '../compiler/ir-v2/lower-primitives.mjs';
import {emitCoreWasm} from '../compiler/backends/wasm/index.mjs';
import {packageCommand} from '../compiler/components/package-command.mjs';
import {tool,root} from '../scripts/phase4-toolchain.mjs';
import {arrayCases} from './helpers/array-cases.mjs';
const wasmTools=tool('wasm-tools'),wasmtime=tool('wasmtime');
const compile=s=>emitCoreWasm(lowerPrimitives(buildSemantic(s,{dynamic:true})),{target:'command-adapter'});
function withComponent(core,fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-array-command-'));try{const file=path.join(dir,'command.wasm');fs.writeFileSync(file,packageCommand(core));return fn(file);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const display=x=>Object.is(x,-0)?'-0':String(x);
for(const c of arrayCases)test(`WASI arrays: ${c.name}`,()=>withComponent(compile(c.source),file=>assert.equal(execFileSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000}),c.expected.map(display).join('\n')+'\n')));
test('array component retains the command WIT',()=>withComponent(compile('let a=[1];console.log(a[0]);'),file=>assert.equal(execFileSync(wasmTools,['component','wit',file],{encoding:'utf8'}),fs.readFileSync(path.join(root,'docs/command-world.wit'),'utf8'))));
test('component collector traces references stored in arrays',()=>{
 const source='let keep=["component child"];let cycle=[null];cycle[0]=cycle;for(let i=0;i<40000;i++){let garbage="discard="+i;}console.log(keep[0]);console.log(cycle.length);';
 withComponent(compile(source),file=>assert.equal(execFileSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000}),'component child\n1\n'));
});
