import { spawnSync } from 'node:child_process';
import { tool } from './phase4-toolchain.mjs';
const [input, ...args] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node scripts/run-component.mjs input.component.wasm [arguments...]');
  process.exitCode = 1;
} else {
  try {
    const result = spawnSync(tool('wasmtime'), ['run', '--', input, ...args], { stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
