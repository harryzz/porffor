import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, tool } from './phase4-toolchain.mjs';
const cwd = path.join(root, 'component-runtime');
execFileSync('cargo', ['+1.95.0', 'build', '--locked', '--target', 'wasm32-unknown-unknown', '--release'], { cwd, stdio: 'inherit' });
execFileSync(tool('wasm-tools'), ['validate', path.join(cwd, 'target/wasm32-unknown-unknown/release/porffor_wasip3_command.wasm')], { stdio: 'inherit' });
