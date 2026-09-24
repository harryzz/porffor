import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
export const root = path.resolve(import.meta.dirname, '..');
export const toolRoot = path.join(root, '.tools', 'phase4');
export const pins = Object.freeze({
  wasmtime: {
    version: '46.0.3', directory: 'wasmtime-v46.0.3-x86_64-linux',
    url: 'https://github.com/bytecodealliance/wasmtime/releases/download/v46.0.3/wasmtime-v46.0.3-x86_64-linux.tar.xz',
    sha256: 'a13087bea96394e183a205d653e7337d50b596aca3090d496330efc770a54121'
  },
  'wasm-tools': {
    version: '1.252.0', directory: 'wasm-tools-1.252.0-x86_64-linux',
    url: 'https://github.com/bytecodealliance/wasm-tools/releases/download/v1.252.0/wasm-tools-1.252.0-x86_64-linux.tar.gz',
    sha256: '097b1181d5b2bc3f2ebc44b4e72edf18308902023f1f1483a1a7dc1268ea988d'
  }
});
export function tool(name) {
  const pin = pins[name];
  if (!pin) throw new Error(`Unknown Phase 4 tool: ${name}`);
  const file = path.join(toolRoot, pin.directory, name);
  if (!fs.existsSync(file)) throw new Error(`Missing ${name}; run node scripts/setup-phase4.mjs`);
  const version = execFileSync(file, ['--version'], { encoding: 'utf8' }).trim();
  if (!version.startsWith(`${name} ${pin.version}`) || /[\d.]/.test(version.charAt(`${name} ${pin.version}`.length)))
    throw new Error(`Expected ${name} ${pin.version}, found ${version}`);
  return file;
}
export const runtimeWasm = path.join(root, 'component-runtime', 'target', 'wasm32-unknown-unknown', 'release', 'porffor_wasip3_command.wasm');
