import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { packageCommand } from '../compiler/components/package-command.mjs';
import { root, tool } from '../scripts/phase4-toolchain.mjs';
import { cases } from './helpers/numeric-cases.mjs';
const wasmtime = tool('wasmtime'), wasmTools = tool('wasm-tools');
const compile = source => emitCoreWasm(lowerSemantic(buildSemantic(source)), {target:'command-adapter'});
function withComponent(core, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'porffor-command-test-'));
  try {
    const file = path.join(dir,'command.wasm');
    fs.writeFileSync(file,packageCommand(core));
    return fn(file);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
const run = (file,args=[]) => spawnSync(wasmtime,['run','--',file,...args],{encoding:'utf8',timeout:30000});
const text = values => values.map(x=>Object.is(x,-0)?'-0':String(x)).map(x=>`${x}\n`).join('');
for (const c of cases) test(`WASI 0.3 stdout and normal return: ${c.name}`,()=> {
  withComponent(compile(c.source),file=>{
    const result = run(file);
    assert.equal(result.error,undefined);
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout,text(c.expected));
    assert.equal(result.stderr,'');
  });
});
test('WIT exposes stable WASI 0.3 command run and stdout, without custom imports',()=> {
  withComponent(compile('console.log(42);'),file=> {
    const wit = execFileSync(wasmTools,['component','wit',file],{encoding:'utf8'});
    assert.equal(wit,fs.readFileSync(path.join(root,'docs/command-world.wit'),'utf8'));
    assert.match(wit,/export wasi:cli\/run@0\.3\.0/);
    assert.match(wit,/run: async func\(\) -> result/);
    assert.doesNotMatch(wit,/porffor|0\.2\.|0\.3\.0-rc/);
  });
});
test('real WASI arguments reach numeric source, excluding argv[0]',()=> {
  const args = ['20','  -2.5\t','+.5e1','-0','1e309','0x10','','NaN','Infinity','1_2','1 2','\u00a01','5.','\v6\f'];
  const source = 'console.log(Porffor.argumentCount());for(let i=0;i<Porffor.argumentCount();i++)console.log(Porffor.argumentNumber(i));console.log(Porffor.argumentNumber(-1));console.log(Porffor.argumentNumber(.5));console.log(Porffor.argumentNumber(1/0));console.log(Porffor.argumentNumber(0/0));console.log(Porffor.argumentNumber(100));';
  withComponent(compile(source),file=> {
    const result=run(file,args);
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout,text([args.length,20,-2.5,5,-0,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,5,6,NaN,NaN,NaN,NaN,NaN]));
  });
});
test('an empty command returns normally without stdout',()=> {
  withComponent(compile(''),file=> {
    const result=run(file);
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
  });
});
test('core trap terminates the command with a failing exit status',()=> {
  // Harness-only raw core fixture: no source-language exception semantics implied.
  const core=execFileSync(wasmTools,['parse','-'],{input:'(module (func (export "main") unreachable))'});
  withComponent(core,file=>{
    const result=run(file);
    assert.equal(result.error,undefined);assert.notEqual(result.status,0);
    assert.match(result.stderr,/unreachable/);assert.equal(result.stdout,'');
  });
});
test('stdout failure becomes an error result, not a successful command',()=> {
  withComponent(compile('console.log(42);'),file=>{
    const fd=fs.openSync('/dev/full','w');
    try {
      const result=spawnSync(wasmtime,['run','--',file],{stdio:['ignore',fd,'pipe'],encoding:'utf8',timeout:30000});
      assert.equal(result.error,undefined);assert.equal(result.status,1);assert.equal(result.stderr,'');
    } finally {fs.closeSync(fd);}
  });
});
test('buffer overflow returns an error and does not publish truncated stdout',()=> {
  withComponent(compile('for(let i=0;i<1600000;i++)console.log(1234567890);'),file=>{
    const result=run(file);
    assert.equal(result.error,undefined);assert.equal(result.status,1);
    assert.equal(result.stderr,'');assert.equal(result.stdout,'');
  });
});
test('packager rejects a Node-host module instead of leaking custom imports',()=> {
  const core=emitCoreWasm(lowerSemantic(buildSemantic('console.log(1);')));
  assert.throws(()=>packageCommand(core));
});
test('packager rejects malformed core bytes and an incompatible main signature',()=> {
  assert.throws(()=>packageCommand(new Uint8Array([0,1,2])));
  const core=execFileSync(wasmTools,['parse','-'],{input:'(module (func (export "main") (param i32)))'});
  assert.throws(()=>packageCommand(core));
});
test('compiler and runner CLIs produce and execute a standalone component',()=> {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'porffor-command-cli-'));
  try {
    const output=path.join(dir,'out.wasm');
    execFileSync(process.execPath,['scripts/compile-component.mjs','examples/numeric/arguments.js',output],{cwd:root});
    assert.equal(execFileSync(process.execPath,['scripts/run-component.mjs',output,'20','22'],{cwd:root,encoding:'utf8'}),'42\n');
    const bad=path.join(dir,'bad.js'),failed=path.join(dir,'bad.wasm');
    fs.writeFileSync(bad,'console.log("no strings yet");');
    const result=spawnSync(process.execPath,['scripts/compile-component.mjs',bad,failed],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,1);assert.equal(fs.existsSync(failed),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
