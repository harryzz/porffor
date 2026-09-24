import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { executeLowered } from './helpers/execute-lowered.mjs';
import { executeWasm } from './helpers/execute-wasm.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { cases } from './helpers/numeric-cases.mjs';

function parseOutput(stdout) {
  const clean = stripVTControlCharacters(stdout).trim();
  if (!clean) return [];
  return clean.split('\n').map(line => {
    const text = line.trim();
    if (text === 'true' || text === 'false') return text === 'true';
    if (/^[+-]?nan$/i.test(text)) return NaN;
    if (/^[+]?inf(?:inity)?$/i.test(text)) return Infinity;
    if (/^-inf(?:inity)?$/i.test(text)) return -Infinity;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) throw new Error(`Unexpected oracle output: ${text}`);
    return Number(text);
  });
}

const cc = process.env.PHASE2_CC ?? '/usr/bin/clang-19';
const root = path.resolve(import.meta.dirname, '..');
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
// Mandatory oracle: failures to locate/execute Clang are failures, not skipped tests.
run(cc, ['--version']);
for (const {name, source, expected, legacyExpected, legacyIssue} of cases) test(`differential Node / C / lowered / Wasm: ${name}`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js2wasi-numeric-'));
  try {
    const js = path.join(dir, 'case.js'), c = path.join(dir, 'case.c'), bin = path.join(dir, 'case');
    fs.writeFileSync(js, source);
    const lowered = lowerSemantic(buildSemantic(source));
    const actual = executeLowered(lowered);
    assert.deepEqual(executeWasm(lowered), actual, 'direct Wasm agrees with lowered IR');
    assert.deepEqual(executeWasm(lowerPrimitives(buildSemantic(source,{dynamic:true}))),actual,'boxed Wasm agrees with numeric path');
    assert.deepEqual(actual, expected, 'lowered IR matches independent expected values');
    assert.deepEqual(parseOutput(run(process.execPath, [js])), actual, 'Node agrees');
    run(process.execPath, ['runtime/index.js', 'c', js, '-o', c]);
    run(cc, ['-O0', '-w', c, '-o', bin, '-lm']);
    const native = parseOutput(run(bin, []));
    if (legacyExpected) {
      assert.ok(legacyIssue, 'every known discrepancy needs an explicit explanation');
      assert.deepEqual(native, legacyExpected, `recorded upstream regression changed: ${legacyIssue}`);
      assert.notDeepEqual(native, actual, 'remove the known discrepancy once upstream agrees');
    } else assert.deepEqual(native, actual, 'retained Porffor C backend agrees');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
