import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
export const root = path.resolve(import.meta.dirname, '..');
export const toolRoot = path.join(root, '.tools', 'phase4');
export const pins = Object.freeze({
  wasmtime: {
    version: '49.0.0', directory: 'wasmtime-v49.0.0-x86_64-linux',
    url: 'https://github.com/bytecodealliance/wasmtime/releases/download/v49.0.0/wasmtime-v49.0.0-x86_64-linux.tar.xz',
    sha256: 'a956c279ac6e80109369a285db30fc46f68239fa1bbeb03ccfa8e913bbca85fc'
  },
  'wasm-tools': {
    version: '1.259.0', directory: 'wasm-tools-1.259.0-x86_64-linux',
    url: 'https://github.com/bytecodealliance/wasm-tools/releases/download/v1.259.0/wasm-tools-1.259.0-x86_64-linux.tar.gz',
    sha256: '3e9b374b4c7715b771b69bf0d65a337990ed4546ec5e97e01c0ff587dfc52160'
  },
  wac: {
    version: '0.11.0', directory: 'wac-cli-0.11.0-x86_64-linux', executable: 'wac', versionLabel: 'wac-cli',
    url: 'https://github.com/bytecodealliance/wac/releases/download/v0.11.0/wac-cli-x86_64-unknown-linux-musl',
    sha256: '83259349b630f79a60490322b068e7ad2dba784720b0d467decccc0aecc743b5',
    raw: true
  }
});
export function tool(name) {
  const pin = pins[name];
  if (!pin) throw new Error(`Unknown Phase 4 tool: ${name}`);
  const file = path.join(toolRoot, pin.directory, pin.executable ?? name);
  if (!fs.existsSync(file)) throw new Error(`Missing ${name}; run node scripts/setup-phase4.mjs`);
  const version = execFileSync(file, ['--version'], { encoding: 'utf8' }).trim();
  const label = pin.versionLabel ?? name;
  if (!version.startsWith(`${label} ${pin.version}`) || /[\d.]/.test(version.charAt(`${label} ${pin.version}`.length)))
    throw new Error(`Expected ${name} ${pin.version}, found ${version}`);
  return file;
}
export const runtimeWasm = path.join(root, 'component-runtime', 'target', 'wasm32-unknown-unknown', 'release', 'porffor_wasip3_command.wasm');
