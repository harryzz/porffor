// Experimental direct core-Wasm backend. Production compilation does not import this.
import { validate } from '../../ir-v2/lowered.mjs';

import { types, uleb, vector, string, section, get, set, i32, i64, f64, body } from './encoding.mjs';
import { stringHelpers } from './strings.mjs';
import { primitiveHelpers } from './primitives.mjs';
import { VALUE_NULL, VALUE_UNDEFINED } from '../../runtime-v2/value-layout.mjs';

const opcode = {
  I32Add: 0x6a, U32Add: 0x6a, I32Subtract: 0x6b, U32Subtract: 0x6b,
  I32Multiply: 0x6c, U32Multiply: 0x6c, I32Equal: 0x46, U32Equal: 0x46,
  I32LessThan: 0x48, U32LessThan: 0x49,
  I64Add: 0x7c, U64Add: 0x7c, I64Subtract: 0x7d, U64Subtract: 0x7d,
  I64Multiply: 0x7e, U64Multiply: 0x7e, I64Equal: 0x51, U64Equal: 0x51,
  I64LessThan: 0x53, U64LessThan: 0x54,
  F64Add: 0xa0, F64Subtract: 0xa1, F64Multiply: 0xa2, F64Divide: 0xa3,
  F64Equal: 0x61, F64NotEqual: 0x62, F64LessThan: 0x63,
  F64GreaterThan: 0x64, F64LessEqual: 0x65, F64GreaterEqual: 0x66,
  F64Negate: 0x9a, I32ToF64: 0xb7, U32ToF64: 0xb8,
  I32BitAnd: 0x71, I32BitOr: 0x72, I32BitXor: 0x73,
  I32ShiftLeft: 0x74, I32ShiftRight: 0x75, U32ShiftRight: 0x76
};

// Extract the low 32 integer bits of the binary64 significand. For unbiased
// exponent < 0 the truncation is zero; >= 84 all low 32 bits are zero (also
// handles NaN/infinity). No trapping float-to-integer instruction or host call.
function toInt32Body() {
  return body(['i64', 'i32', 'i32'], [
    ...get(0), 0xbd, ...set(1), // i64.reinterpret_f64
    ...get(1), ...i64(52), 0x88, 0xa7, ...i32(2047), 0x71,
    ...i32(1023), 0x6b, ...set(2),
    ...get(2), ...i32(0), 0x48, ...get(2), ...i32(84), 0x4e, 0x72,
    0x04, 0x40, ...i32(0), 0x0f, 0x0b,
    ...get(1), ...i64((1n << 52n) - 1n), 0x83,
    ...i64(1n << 52n), 0x84, ...set(1),
    ...get(2), ...i32(52), 0x48,
    0x04, 0x7e, // if (result i64)
      ...get(1), ...i32(52), ...get(2), 0x6b, 0xad, 0x88,
    0x05,
      ...get(1), ...get(2), ...i32(52), 0x6b, 0xad, 0x86,
    0x0b, 0xa7, ...set(3),
    ...get(0), ...f64(0), 0x63,
    0x04, 0x7f, ...i32(0), ...get(3), 0x6b,
    0x05, ...get(3), 0x0b
  ]);
}

export function emitCoreWasm(mod, { target = 'host', stringHeapBytes } = {}) {
  if (!['host', 'command-adapter'].includes(target)) throw new TypeError(`Wasm: unsupported target ${target}`);
  validate(mod);
  const closureFunctions=mod.functions.filter(f=>f.name.startsWith('lambda'));
  // Opaque runtime representations deliberately have no backend mapping yet.
  const requireType = t => {
    if (t !== 'none' && !Object.hasOwn(types, t)) throw new TypeError(`Wasm: unsupported representation ${t}`);
  };
  const used = new Set();
  for (const f of mod.functions) {
    requireType(f.result);
    f.params.forEach(p => requireType(p.type));
    for (const b of f.blocks) {
      b.params.forEach(p => requireType(p.type));
      b.instructions.forEach(n => { requireType(n.type); used.add(n.op); });
    }
  }
  const heapEnabled = [...used].some(op=>['ValueString','ValueAdd','StringLength','ValueLength','ArrayCreate','Uint8ArrayCreate','ValueGetIndex','ValueSetIndex','ObjectCreate','ClosureCreate','IndirectCall','ValueGetProperty','ValueSetProperty'].includes(op));
  const stringSupport = heapEnabled ? stringHelpers(
    mod.functions.flatMap(f=>f.blocks.flatMap(b=>b.instructions.filter(n=>n.op==='ValueString').map(n=>n.value))),
    stringHeapBytes === undefined ? {} : {heapBytes:stringHeapBytes}
  ) : null;
  const registry = stringSupport?.registry ?? primitiveHelpers;
  if (heapEnabled) {
    used.add('HeapBase');
    for (const op of ['RootEnter','RootSet','RootLeave']) used.add(op);
    if (used.has('PrintValue')) used.add('PrintString');
    if (used.has('ValueAdd')) used.add('FormatNumber');
  }
  if (used.has('PrintValue')) for (const op of ['PrintNumber','PrintBoolean','PrintNull','PrintUndefined']) used.add(op);
  const signatures = [], signatureIds = new Map();
  const signature = (params, result) => {
    const bytes = [0x60, ...vector(params.map(t => [types[t]])), ...vector(result === 'none' ? [] : [[types[result]]])];
    const key = bytes.join(',');
    if (!signatureIds.has(key)) { signatureIds.set(key, signatures.length); signatures.push(bytes); }
    return signatureIds.get(key);
  };
  const imports = [], intrinsicIndices = new Map();
  for (const [op, name, params, result] of [
    ['PrintNumber', 'print_number', ['f64'], 'none'],
    ['PrintBoolean', 'print_boolean', ['i32'], 'none'],
    ['PrintNull', 'print_null', [], 'none'],
    ['PrintUndefined', 'print_undefined', [], 'none'],
    ['ArgumentCount', 'argument_count', [], 'f64'],
    ['ArgumentNumber', 'argument_number', ['f64'], 'f64'],
    ['HeapBase','string_heap_base',[],'i32'],
    ['PrintString','print_string',['i32','i32'],'none'],
    ['FormatNumber','format_number',['f64','i32'],'i32']
  ]) {
    if (!used.has(op)) continue;
    intrinsicIndices.set(op, imports.length);
    imports.push([...string(target === 'command-adapter' ? '__main_module__' : 'porffor'), ...string(name), 0, ...uleb(signature(params, result))]);
  }
  if(used.has('IndirectCall')){used.add('ClosureEnvironment');used.add('ClosureCode');}
  const functionIds = new Map(mod.functions.map((f, i) => [f.name, imports.length + i]));
  const functionTypes = mod.functions.map(f => uleb(signature(f.params.map(p => p.type), f.result)));
  const helpers = new Map();
  const requireHelper = name => {
    if (helpers.has(name)) return;
    const spec = registry[name];
    if (!spec) throw new TypeError(`Wasm: missing primitive helper ${name}`);
    for (const dep of spec.dependencies ?? []) requireHelper(dep);
    helpers.set(name, { ...spec, index: imports.length + mod.functions.length + helpers.size });
  };
  for (const op of used) if (Object.hasOwn(registry,op)) requireHelper(op);
  if (heapEnabled) for (const {name} of stringSupport.literals.values()) requireHelper(name);
  const needsConversion = used.has('F64ToInt32') || used.has('F64ToUint32');
  const conversionIndex = imports.length + mod.functions.length + helpers.size;
  for (const spec of helpers.values()) functionTypes.push(uleb(signature(spec.params,spec.result)));
  if (needsConversion) functionTypes.push(uleb(signature(['f64'], 'i32')));
  const bodies = mod.functions.map(f => {
    const locals = [], ids = new Map(f.params.map((p, i) => [p.id, i]));
    const allocate = (id, type) => { ids.set(id, f.params.length + locals.length); locals.push(type); };
    for (const b of f.blocks) {
      b.params.forEach(p => allocate(p.id, p.type));
      b.instructions.filter(n => n.id !== null).forEach(n => allocate(n.id, n.type));
    }
    const closureDispatch=f.blocks.some(b=>b.instructions.some(n=>n.op==='IndirectCall'))?f.params.length+locals.length:null;
    if(closureDispatch!==null)locals.push('i32');
    const pc = f.params.length + locals.length;
    locals.push('i32');
    const frame = f.params.length + locals.length;
    if (heapEnabled) locals.push('i32');
    const returned = f.params.length + locals.length;
    if (heapEnabled && f.result !== 'none') locals.push(f.result);
    const rootIds = heapEnabled ? [
      ...f.params,
      ...f.blocks.flatMap(b=>[...b.params,...b.instructions.filter(n=>n.id!==null)])
    ].filter(x=>x.type==='jsval') : [];
    const rootSlots = new Map(rootIds.map((x,i)=>[x.id,i]));
    const blocks = new Map(f.blocks.map((b, i) => [b.id, i]));
    const read = id => get(ids.get(id));
    const sync = id => rootSlots.has(id)
      ? [...get(frame),...i32(rootSlots.get(id)),...read(id),0x10,...uleb(helpers.get('RootSet').index)] : [];
    const code = [];
    if (heapEnabled) {
      code.push(...i32(rootIds.length),0x10,...uleb(helpers.get('RootEnter').index),...set(frame));
      for (const p of f.params) code.push(...sync(p.id));
    }
    code.push(...i32(blocks.get(f.entry)), ...set(pc), 0x03, 0x40); // dispatcher loop
    const edge = (target, args) => {
      // Stack all sources before writing destinations: parallel block arguments.
      for (const arg of args) code.push(...read(arg));
      for (const p of [...f.blocks[blocks.get(target)].params].reverse()) code.push(...set(ids.get(p.id)));
      for (const p of f.blocks[blocks.get(target)].params) code.push(...sync(p.id));
      code.push(...i32(blocks.get(target)), ...set(pc));
    };
    for (const [index, b] of f.blocks.entries()) {
      code.push(...get(pc), ...i32(index), 0x46, 0x04, 0x40);
      for (const n of b.instructions) {
        if(n.op==='IndirectCall'){
          code.push(0x02,0x7e,...read(n.args[0]),0x10,...uleb(helpers.get('ClosureCode').index),...set(closureDispatch));
          for(let target=0;target<closureFunctions.length;target++){
            code.push(...get(closureDispatch),...i32(target),0x46,0x04,0x7e,
              ...read(n.args[0]),0x10,...uleb(helpers.get('ClosureEnvironment').index),...read(n.args[1]),0x10,...uleb(functionIds.get(closureFunctions[target].name)),0x05);
          }
          code.push(0x00,...Array(closureFunctions.length).fill(0x0b),0x0b);
        } else {
          for (const arg of n.args) code.push(...read(arg));
        }
        if(n.op==='IndirectCall'){}
        else if (helpers.has(n.op)) code.push(0x10,...uleb(helpers.get(n.op).index));
        else if (Object.hasOwn(opcode, n.op)) code.push(opcode[n.op]);
        else switch (n.op) {
          case 'I32Const': case 'U32Const': code.push(...i32(n.value)); break;
          case 'I64Const': case 'U64Const': code.push(...i64(n.value)); break;
          case 'ValueString': code.push(0x10,...uleb(helpers.get(stringSupport.literals.get(n.value).name).index)); break;
          case 'ValueNull': code.push(...i64(VALUE_NULL)); break;
          case 'ValueUndefined': code.push(...i64(VALUE_UNDEFINED)); break;
          case 'F64Const': code.push(...f64(n.value)); break;
          case 'F64Identity': break;
          case 'I32BitNot': code.push(...i32(-1), 0x73); break;
          case 'F64Truthy':
            code.push(...f64(0), 0x62, ...read(n.args[0]), ...read(n.args[0]), 0x61, 0x71); break;
          case 'F64ToInt32': case 'F64ToUint32': code.push(0x10, ...uleb(conversionIndex)); break;
          case 'DirectCall': code.push(0x10, ...uleb(functionIds.get(n.callee))); break;
          case 'ArgumentCount': case 'ArgumentNumber':
          case 'PrintNumber': case 'PrintBoolean': code.push(0x10, ...uleb(intrinsicIndices.get(n.op))); break;
          default: throw new TypeError(`Wasm: unsupported operation ${n.op}`);
        }
        if (n.id !== null) code.push(...set(ids.get(n.id)),...sync(n.id));
      }
      const t = b.terminator;
      if (t.op === 'Return') {
        if (heapEnabled) {
          if (t.value !== null) code.push(...read(t.value),...set(returned));
          code.push(...get(frame),...i32(rootIds.length),0x10,...uleb(helpers.get('RootLeave').index));
          if (t.value !== null) code.push(...get(returned));
        } else if (t.value !== null) code.push(...read(t.value));
        code.push(0x0f);
      } else {
        if (t.op === 'Branch') edge(t.target, t.args);
        else {
          code.push(...read(t.condition), 0x04, 0x40);
          edge(t.thenTarget, t.thenArgs);
          code.push(0x05);
          edge(t.elseTarget, t.elseArgs);
          code.push(0x0b);
        }
        code.push(0x0c, 1); // from case if to dispatcher loop
      }
      code.push(0x0b);
    }
    code.push(0x00, 0x0b, 0x00); // invalid PC traps; no implicit typed fallthrough
    return body(locals, code);
  });
  const call = name => [0x10,...uleb(helpers.has(name)?helpers.get(name).index:intrinsicIndices.get(name))];
  for (const spec of helpers.values()) bodies.push(spec.emit(call));
  if (needsConversion) bodies.push(toInt32Body());
  const exports = mod.functions.map(f => [...string(f.name), 0, ...uleb(functionIds.get(f.name))]);
  const names = mod.functions.map(f => [...uleb(functionIds.get(f.name)), ...string(f.name)]);
  for (const [name,spec] of helpers) names.push([...uleb(spec.index),...string(name)]);
  if (needsConversion) names.push([...uleb(conversionIndex), ...string('js_to_int32')]);
  const namePayload = vector(names);
  const moduleImports = [...imports];
  if (heapEnabled) moduleImports.push([...string(target==='command-adapter'?'__main_module__':'porffor'),...string('memory'),2,0,0]);
  const globals = heapEnabled ? section(6,vector(Array.from({length:stringSupport.globalCount},()=>[0x7f,1,...i32(0),0x0b]))) : [];
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector(signatures)), ...section(2, vector(moduleImports)),
    ...section(3, vector(functionTypes)), ...globals, ...section(7, vector(exports)),
    ...section(10, vector(bodies)),
    ...section(0, [...string('name'), 1, ...uleb(namePayload.length), ...namePayload])
  ]);
}
