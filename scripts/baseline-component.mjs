import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { root, tool } from './phase4-toolchain.mjs';
assert.equal(process.versions.node,'20.19.2','component baseline requires Node 20.19.2');
const logs=fs.mkdtempSync(path.join(os.tmpdir(),'js2wasi-component-baseline-'));
console.log(`Component baseline logs: ${logs}`);
const versions=[`Node ${process.versions.node}`];
for(const name of ['wasmtime','wasm-tools']) versions.push(execFileSync(tool(name),['--version'],{encoding:'utf8'}).trim());
versions.push(execFileSync('rustc',['+1.95.0','--version'],{encoding:'utf8'}).trim());
fs.writeFileSync(path.join(logs,'versions.txt'),versions.join('\n')+'\n');
for(const [label,args] of [
  ['runtime-build',['scripts/build-component-runtime.mjs']],
  ['component-tests',['--test','tests/command-arguments.test.mjs','tests/component-command.test.mjs','tests/primitive-component.test.mjs','tests/string-component.test.mjs','tests/array-component.test.mjs','tests/object-component.test.mjs','tests/closure-component.test.mjs']]
]) {
  const log=path.join(logs,`${label}.log`),fd=fs.openSync(log,'w');
  try {
    execFileSync(process.execPath,args,{cwd:root,stdio:['ignore',fd,fd],timeout:600000});
    console.log(`PASS ${label}`);
  } catch(error) {
    console.error(`FAIL ${label}: ${log}\n${fs.readFileSync(log,'utf8').slice(-4000)}`);
    throw error;
  } finally {fs.closeSync(fd);}
}
console.log('Component baseline complete');
