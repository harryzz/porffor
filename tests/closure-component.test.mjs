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
import {tool} from '../scripts/phase4-toolchain.mjs';
import {closureCases} from './helpers/closure-cases.mjs';
const wasmtime=tool('wasmtime');
const compile=source=>emitCoreWasm(lowerPrimitives(buildSemantic(source,{dynamic:true})),{target:'command-adapter'});
function run(source,expected){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-closure-component-'));try{const file=path.join(dir,'command.wasm');fs.writeFileSync(file,packageCommand(compile(source)));assert.equal(execFileSync(wasmtime,['run','--',file],{encoding:'utf8',timeout:30000}),expected.map(x=>String(x)).join('\n')+'\n');}finally{fs.rmSync(dir,{recursive:true,force:true});}}
for(const c of closureCases)test(`WASI closures: ${c.name}`,()=>run(c.source,c.expected));
