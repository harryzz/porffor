// Development host for the two fixed print imports; no WASI/component ABI.
import fs from 'node:fs';
import { coreHost } from './core-host.mjs';
const [input, ...args] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node scripts/run-numeric-wasm.mjs input.wasm [arguments...]');
  process.exitCode = 1;
} else {
  try {
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(input), {
      porffor: coreHost(args)
    });
    if (typeof instance.exports.main !== 'function') throw new Error('Expected a main export');
    instance.exports.main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
