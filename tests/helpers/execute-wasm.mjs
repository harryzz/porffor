import assert from 'node:assert/strict';
import { coreHost } from '../../scripts/core-host.mjs';
import { emitCoreWasm } from '../../compiler/backends/wasm/index.mjs';

export function executeWasm(mod, args = []) {
  const bytes = emitCoreWasm(mod);
  assert.equal(WebAssembly.validate(bytes), true, 'emitted binary validates');
  const output = [];
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    porffor: coreHost(args,x=>output.push(x))
  });
  instance.exports.main();
  return output;
}
