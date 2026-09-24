// Experimental review tool: source -> semantic IR -> lowered IR. No execution/emission.
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { buildSemantic } from '../compiler/ir-v2/frontend.mjs';
import { lowerSemantic } from '../compiler/ir-v2/lower.mjs';
import { lowerPrimitives } from '../compiler/ir-v2/lower-primitives.mjs';

const dynamic = process.argv[2] === '--primitives';
const lower = dynamic ? lowerPrimitives : lowerSemantic;
const [input, output, ...extra] = process.argv.slice(dynamic ? 3 : 2);
if (!input || !output || extra.length) {
  console.error('Usage: node scripts/compile-numeric.mjs [--primitives] input.js output-directory');
  process.exitCode = 1;
} else {
  try {
    const semantic = buildSemantic(fs.readFileSync(input, 'utf8'),{dynamic});
    const lowered = lower(semantic);
    // Validate both stages before creating any files. Text preserves NaN, Infinity
    // and -0, unlike JSON.stringify. Dumps are for review, not a serialization ABI.
    fs.mkdirSync(output, { recursive: true });
    for (const [name, ir] of [['semantic', semantic], ['lowered', lowered]]) {
      fs.writeFileSync(path.join(output, `${name}.txt`), inspect(ir, { depth: null, colors: false, compact: false, maxArrayLength: null }) + '\n');
    }
    console.log(`Validated ${lowered.functions.length} functions; wrote semantic.txt and lowered.txt to ${output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
