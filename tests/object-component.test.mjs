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
import {objectCases} from './helpers/object-cases.mjs';
const wasmTools=tool('wasm-tools'),wasmtime=tool('wasmtime');
const compile=s=>emitCoreWasm(lowerPrimitives(buildSemantic(s,{dynamic:true})),{target:'command-adapter'});
function withComponent(core,fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-object-command-'));try{const file=path.join(dir,'command.wasm');fs.writeFileSync(file,packageCommand(core));return fn(file);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const display=x=>Object.is(x,-0)?'-0':String(x);
for(const c of objectCases)test(`WASI objects: ${c.name}`,()=>withComponent(compile(c.source),file=>assert.equal(execFileSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000}),c.expected.map(display).join('\n')+'\n')));
test('object component retains the command WIT',()=>withComponent(compile('let o={value:1};console.log(o.value);'),file=>assert.equal(execFileSync(wasmTools,['component','wit',file],{encoding:'utf8'}),fs.readFileSync(path.join(root,'docs/command-world.wit'),'utf8'))));
test('component collector traces object fields and cycles',()=>{
 const source='let cycle={next:null,number:9};cycle.next=cycle;let keep={child:{text:"component object"}};for(let i=0;i<40000;i++){let garbage="discard="+i;}console.log(cycle.number);console.log(keep.child.text);';
 withComponent(compile(source),file=>assert.equal(execFileSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000}),'9\ncomponent object\n'));
});
