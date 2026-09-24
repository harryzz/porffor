import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {stripVTControlCharacters} from 'node:util';
import {buildSemantic} from '../compiler/ir-v2/frontend.mjs';
import {lowerPrimitives} from '../compiler/ir-v2/lower-primitives.mjs';
import {executeWasm} from './helpers/execute-wasm.mjs';
import {stringCases} from './helpers/string-cases.mjs';
const cc=process.env.PHASE2_CC??'/usr/bin/clang-19';
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
const utf8=s=>Buffer.from(s,'utf8').toString('utf8');
const display=x=>Object.is(x,-0)?'-0':String(x);
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const nativePattern=values=>new RegExp('^'+values.map(x=>typeof x==='number'&&Number.isNaN(x)?'[+-]?[nN][aA][nN]':escape(utf8(display(x)))).join('\n')+'\n$');
run(cc,['--version']);
for(const c of stringCases)test(`string Node / C / Wasm differential: ${c.name}`,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-string-oracle-'));
 try{
  const js=path.join(dir,'case.js'),native=path.join(dir,'case.c'),bin=path.join(dir,'case');fs.writeFileSync(js,c.source);
  assert.deepEqual(executeWasm(lowerPrimitives(buildSemantic(c.source,{dynamic:true}))),c.expected);
  const expected=utf8(c.expected.map(display).join('\n')+'\n');
  assert.equal(run(process.execPath,['-e',"new (require('node:vm').Script)(require('node:fs').readFileSync(process.argv[1],'utf8')).runInNewContext({console})",js]),expected);
  run(process.execPath,['runtime/index.js','c',js,'-o',native]);run(cc,['-O0','-w',native,'-o',bin,'-lm']);
  const actual=stripVTControlCharacters(run(bin,[]));
  if(c.legacyStdout!==undefined){
   assert.ok(c.legacyIssue);assert.equal(actual,c.legacyStdout,c.legacyIssue);assert.notEqual(actual,expected);
  }else assert.match(actual,nativePattern(c.expected),'retained C output');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
