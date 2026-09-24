// Explicit network/setup step. Compilation and tests never silently download tools.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pins, toolRoot, tool } from './phase4-toolchain.mjs';
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Pinned Phase 4 binaries currently require Linux x86_64');
fs.mkdirSync(toolRoot, { recursive: true });
for (const [name, pin] of Object.entries(pins)) {
  const response = await fetch(pin.url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${pin.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error(`Checksum mismatch: ${name}`);
  const dir = fs.mkdtempSync(path.join(toolRoot, 'download-'));
  try {
    const archive = path.join(dir, 'archive');
    fs.writeFileSync(archive, bytes);
    execFileSync('tar', ['-xf', archive, '-C', dir]);
    fs.cpSync(path.join(dir, pin.directory), path.join(toolRoot, pin.directory), { recursive: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(`Installed and verified ${tool(name)}`);
}
execFileSync('rustup', ['toolchain', 'install', '1.95.0', '--profile', 'minimal', '--target', 'wasm32-unknown-unknown'], { stdio: 'inherit' });
