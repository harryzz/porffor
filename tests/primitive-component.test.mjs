import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync,spawnSync } from 'node:child_process';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { packageCommand } from '../compiler/components/package-command.mjs';
import { tool,root } from '../scripts/phase4-toolchain.mjs';
import { primitiveCases } from './helpers/primitive-cases.mjs';
import { cases } from './helpers/numeric-cases.mjs';
const wasmtime=tool('wasmtime');
const text=values=>values.map(x=>Object.is(x,-0)?'-0':String(x)).map(x=>`${x}\n`).join('');
for(const c of [...primitiveCases,...cases])test(`boxed WASI component: ${c.name}`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-primitive-component-'));
  try{
    const file=path.join(dir,'command.wasm');
    const ir=lowerPrimitives(buildSemantic(c.source,{dynamic:true}));
    fs.writeFileSync(file,packageCommand(emitCoreWasm(ir,{target:'command-adapter'})));
    assert.equal(execFileSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000}),text(c.expected));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('primitive CLI runs both core and component artifacts, with unchanged command WIT',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-primitive-cli-'));
  try{
    const source='examples/primitives/values.js',core=path.join(dir,'core.wasm'),component=path.join(dir,'command.wasm');
    execFileSync(process.execPath,['scripts/compile-wasm.mjs','--primitives',source,core]);
    execFileSync(process.execPath,['scripts/compile-component.mjs','--primitives',source,component]);
    const expected='null\n42\n3\nundefined\nfalse\n';
    assert.equal(execFileSync(process.execPath,['scripts/run-numeric-wasm.mjs',core],{encoding:'utf8'}),expected);
    assert.equal(execFileSync(process.execPath,['scripts/run-component.mjs',component],{encoding:'utf8'}),expected);
    assert.equal(execFileSync(tool('wasm-tools'),['component','wit',component],{encoding:'utf8'}),fs.readFileSync(path.join(root,'docs/command-world.wit'),'utf8'));
    const result=spawnSync(process.execPath,['scripts/compile-wasm.mjs',source,path.join(dir,'rejected.wasm')],{encoding:'utf8'});
    assert.equal(result.status,1);assert.equal(fs.existsSync(path.join(dir,'rejected.wasm')),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
