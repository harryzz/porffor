import fs from 'node:fs';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';
import { packageCommand } from '../compiler/components/package-command.mjs';
import { packageLinkedCommand } from '../compiler/components/package-linked-command.mjs';
const linked = process.argv[2] === '--linked';
const dynamic = process.argv[2] === '--primitives' || linked;
const lower = dynamic ? lowerPrimitives : lowerSemantic;
const [input, output, ...extra] = process.argv.slice(dynamic ? 3 : 2);
if (!input || !output || extra.length) {
  console.error('Usage: node scripts/compile-component.mjs [--primitives|--linked] input.js output.component.wasm');
  process.exitCode = 1;
} else {
  try {
    const ir = lower(buildSemantic(fs.readFileSync(input, 'utf8'), { dynamic }));
    const core = emitCoreWasm(ir, { target: linked ? 'object' : 'command-adapter' });
    const component = linked ? packageLinkedCommand(core) : packageCommand(core);
    fs.writeFileSync(output, component);
    console.log(`Wrote ${component.length} bytes of WASI 0.3 command component to ${output}`);
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = 1;
  }
}
