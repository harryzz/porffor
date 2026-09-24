// Experimental numeric or explicitly selected primitive programs. This emits core Wasm, not a component.
import fs from 'node:fs';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';
import { emitCoreWasm } from '../compiler/backends/wasm/index.mjs';

const dynamic = process.argv[2] === '--primitives';
const lower = dynamic ? lowerPrimitives : lowerSemantic;
const [input, output, ...extra] = process.argv.slice(dynamic ? 3 : 2);
if (!input || !output || extra.length) {
  console.error('Usage: node scripts/compile-wasm.mjs [--primitives] input.js output.wasm');
  process.exitCode = 1;
} else {
  try {
    const bytes = emitCoreWasm(lower(buildSemantic(fs.readFileSync(input, 'utf8'), { dynamic })));
    if (!WebAssembly.validate(bytes)) throw new Error('Generated core Wasm failed validation');
    fs.writeFileSync(output, bytes);
    console.log(`Wrote ${bytes.length} bytes of core Wasm to ${output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
