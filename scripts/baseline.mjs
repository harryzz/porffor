// Run from the repository root. Downloads are explicit setup steps, not hidden here.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
const cc = process.env.SELFHOST_CC ?? '/usr/bin/clang-19';
const test262Commit = '6eec1ac9ee144dafd8f344d73a21f36bfc9f6755';
assert.equal(process.versions.node, '20.19.2', 'baseline requires Node 20.19.2');
const ccVersion = execFileSync(cc, ['--version'], { encoding: 'utf8' });
assert.match(ccVersion, /clang version 19\.1\.7\b/, 'baseline requires Clang 19.1.7');
assert.equal(execFileSync('git', ['-C', 'test262/test262', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), test262Commit);
assert.equal(execFileSync('git', ['-C', 'test262/test262', 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Test262 must be clean');
const out = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'js2wasi-baseline-'));
console.log(`Baseline logs: ${out}`);
fs.writeFileSync(path.join(out, 'versions.txt'), `Node ${process.versions.node}\n${ccVersion}\nTest262 ${test262Commit}\n`);
const env = {
  ...process.env, SELFHOST_CC: cc, CC: cc, PHASE2_CC: cc, CC_OPTS: '-O0 -g',
  SELFHOST_BUNDLE_CMD: process.execPath,
  PORFFOR_TEST262_TCC: path.join(out, 'no-tcc'), PORFFOR_TEST262_TCC_SERVER: '0'
};
function run(label, command, args) {
  const log = path.join(out, `${label}.log`), fd = fs.openSync(log, 'w');
  try {
    execFileSync(command, args, { env, stdio: ['ignore', fd, fd], timeout: 600000 });
    console.log(`PASS ${label}`);
  } catch (e) {
    console.error(`FAIL ${label}: ${log}\n${fs.readFileSync(log, 'utf8').slice(-3000)}`);
    throw e;
  } finally { fs.closeSync(fd); }
}
run('build', process.execPath, ['selfhost', 'compile', '--no-monitor']);
run('parity', process.execPath, ['selfhost', 'verify', '--no-monitor']);
run('test262-harness', process.execPath, ['test262/selfhost.js', 'harness', '--threads=4', '--expect-passes=107', '--dont-write-results']);
const js = path.join(out, 'smoke.js'), c = path.join(out, 'smoke.c'), bin = path.join(out, 'smoke');
fs.writeFileSync(js, 'function add(a, b) { return a + b; }\nconsole.log(add(20, 22));\nlet sum = 0; for (let i = 0; i < 10; i++) sum += i; console.log(sum);\n');
run('smoke-emit', 'selfhosted/porf', ['c', js, '-o', c]);
run('smoke-build', cc, ['-O0', '-w', c, '-o', bin, '-lm']);
const stdout = execFileSync(bin, [], { encoding: 'utf8', timeout: 10000 });
fs.writeFileSync(path.join(out, 'smoke-stdout.log'), stdout);
assert.equal(stripVTControlCharacters(stdout), '42\n45\n');
console.log('PASS native arithmetic/loop stdout');
run('ir-tests', process.execPath, ['--test', 'tests/ir-v2.test.mjs', 'tests/numeric-pipeline.test.mjs', 'tests/integer-lowering.test.mjs', 'tests/wasm-backend.test.mjs', 'tests/command-arguments.test.mjs', 'tests/primitive-values.test.mjs', 'tests/string-values.test.mjs', 'tests/array-values.test.mjs', 'tests/object-values.test.mjs', 'tests/closure-values.test.mjs']);
run('numeric-differential', process.execPath, ['--test', 'tests/numeric-differential.test.mjs']);
run('primitive-differential', process.execPath, ['--test', 'tests/primitive-differential.test.mjs']);
run('string-differential', process.execPath, ['--test', 'tests/string-differential.test.mjs']);
run('array-differential', process.execPath, ['--test', 'tests/array-differential.test.mjs']);
run('object-differential', process.execPath, ['--test', 'tests/object-differential.test.mjs']);
run('closure-differential', process.execPath, ['--test', 'tests/closure-differential.test.mjs']);
run('inventory', process.execPath, ['scripts/backend-coupling-inventory.mjs', '--check']);
console.log('Baseline complete');
