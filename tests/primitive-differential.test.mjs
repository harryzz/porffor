import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { executeWasm } from './helpers/execute-wasm.mjs';
import { executeLowered } from './helpers/execute-lowered.mjs';
import { primitiveCases } from './helpers/primitive-cases.mjs';
const cc=process.env.PHASE2_CC??'/usr/bin/clang-19';
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
const text=values=>values.map(x=>Object.is(x,-0)?'-0':String(x)).map(x=>`${x}\n`).join('');
run(cc,['--version']);
for(const c of primitiveCases)test(`primitive Node / C / IR / Wasm differential: ${c.name}`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-primitives-'));
  try{
    const js=path.join(dir,'case.js'),native=path.join(dir,'case.c'),bin=path.join(dir,'case');
    fs.writeFileSync(js,c.source);
    const m=lowerPrimitives(buildSemantic(c.source,{dynamic:true}));
    assert.deepEqual(executeLowered(m),c.expected);
    assert.deepEqual(executeWasm(m),c.expected);
    assert.equal(run(process.execPath,['-e',"new (require('node:vm').Script)(require('node:fs').readFileSync(process.argv[1],'utf8')).runInNewContext({console})",js]),text(c.expected),'Node output');
    run(process.execPath,['runtime/index.js','c',js,'-o',native]);
    run(cc,['-O0','-w',native,'-o',bin,'-lm']);
    if (c.legacyFailure) {
      assert.ok(c.legacyIssue);
      const result=spawnSync(bin,[],{encoding:'utf8',timeout:30000});
      assert.equal(result.error,undefined);
      assert.equal(result.signal,null);
      assert.equal(result.status,1,c.legacyIssue);
      assert.equal(result.stdout,'');
      assert.equal(stripVTControlCharacters(result.stderr),c.legacyFailure);
      return;
    }
    const nativeOutput=stripVTControlCharacters(run(bin,[]));
    if (c.legacyStdout !== undefined) {
      assert.ok(c.legacyIssue);
      assert.equal(nativeOutput,c.legacyStdout,`recorded C regression changed: ${c.legacyIssue}`);
      assert.notEqual(nativeOutput,text(c.expected),'remove explicit discrepancy if upstream now agrees');
    } else {
      // Native printf spells NaN/Infinity differently; do not normalize blank lines.
      const normalized=nativeOutput.split('\n').map(line=>/^[+-]?nan$/i.test(line)?'NaN':/^[+]?inf(?:inity)?$/i.test(line)?'Infinity':/^-inf(?:inity)?$/i.test(line)?'-Infinity':line).join('\n');
      assert.equal(normalized,text(c.expected),'retained C primitive values');
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
