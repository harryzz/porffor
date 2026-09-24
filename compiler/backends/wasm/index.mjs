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
const paddedUleb32 = value => {
  let n = Number(value) >>> 0;
  const bytes = [];
  for (let i = 0; i < 4; i++, n >>>= 7) bytes.push((n & 0x7f) | 0x80);
  bytes.push(n & 0x0f);
  return bytes;
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
  if (!['host', 'command-adapter', 'component-core', 'object'].includes(target)) throw new TypeError(`Wasm: unsupported target ${target}`);
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
  if (target === 'object') {
    const supported = new Set(['F64Const', 'F64Add', 'F64Subtract', 'F64Multiply', 'F64Divide', 'F64Equal', 'F64NotEqual', 'F64LessThan', 'F64GreaterThan', 'F64LessEqual', 'F64GreaterEqual', 'F64Negate', 'F64Identity', 'DirectCall', 'ValueString', 'ValueBoxNumber', 'ValueBoxBoolean', 'ValueToNumber', 'ValueUnboxNumber', 'ValueTruthy', 'ValueStrictEqual', 'ValueAdd', 'I32Const', 'I32Equal', 'F64ToInt32', 'F64ToUint32', 'I32ToF64', 'U32ToF64', 'I32BitAnd', 'I32BitOr', 'I32BitXor', 'I32BitNot', 'I32ShiftLeft', 'I32ShiftRight', 'U32ShiftRight', 'I32Multiply', 'U32Add', 'ArrayCreate', 'ValueGetIndex', 'ValueSetIndex', 'ValueLength', 'ValueGetProperty', 'PrintNumber', 'PrintBoolean', 'PrintNull', 'PrintUndefined', 'PrintValue']);
    if (!mod.functions.some(f => f.name === 'main') || [...used].some(op => !supported.has(op)))
      throw new TypeError('Wasm object: operation is outside the linked scalar, string, and basic array subset');
  }
  const heapEnabled = [...used].some(op=>['ValueString','ValueAdd','StringLength','ValueLength','ArrayCreate','Uint8ArrayCreate','ValueGetIndex','ValueSetIndex','ObjectCreate','ClosureCreate','IndirectCall','ValueGetProperty','ValueSetProperty'].includes(op));
  const objectGlobalRefs = new Map();
  let nextObjectGlobalMarker = 0;
  const objectGlobalRef = (opcode, index) => {
    const marker = 0x60000000 + nextObjectGlobalMarker++;
    objectGlobalRefs.set(marker, { opcode, index });
    return [opcode, ...paddedUleb32(marker)];
  };
  const stringSupport = heapEnabled ? stringHelpers(
    mod.functions.flatMap(f=>f.blocks.flatMap(b=>b.instructions.filter(n=>n.op==='ValueString').map(n=>n.value))),
    { ...(stringHeapBytes === undefined ? {} : {heapBytes:stringHeapBytes}),
      ...(target === 'object' ? {globalGet:i=>objectGlobalRef(0x23,i),globalSet:i=>objectGlobalRef(0x24,i)} : {}) }
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
    const importModule = target === 'command-adapter' ? '__main_module__'
      : target === 'component-core' ? 'cm32p2|porffor:internal/runtime@0.1'
        : target === 'object' ? 'env'
        : 'porffor';
    const importName = target === 'component-core' ? name.replaceAll('_', '-') : name;
    imports.push([...string(importModule), ...string(importName), 0, ...uleb(signature(params, result))]);
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
  const objectRelocations = [];
  const bodies = mod.functions.map((f, functionIndex) => {
    const objectCallStart = objectRelocations.length;
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
    const code = [];
    const objectCall = symbolIndex => {
      const codeOffset = code.length + 1;
      code.push(0x10, ...paddedUleb32(symbolIndex));
      objectRelocations.push({ functionIndex, symbolIndex, codeOffset, type: 0 });
    };
    const sync = (id, pendingCodeLength = 0) => {
      if (!rootSlots.has(id)) return [];
      const prefix = [...get(frame), ...i32(rootSlots.get(id)), ...read(id)];
      if (target === 'object') {
        objectRelocations.push({ functionIndex, symbolIndex: helpers.get('RootSet').index, codeOffset: code.length + pendingCodeLength + prefix.length + 1, type: 0 });
        return [...prefix, 0x10, ...paddedUleb32(helpers.get('RootSet').index)];
      }
      return [...prefix, 0x10, ...uleb(helpers.get('RootSet').index)];
    };
    if (heapEnabled) {
      code.push(...i32(rootIds.length));
      if (target === 'object') objectCall(helpers.get('RootEnter').index);
      else code.push(0x10, ...uleb(helpers.get('RootEnter').index));
      code.push(...set(frame));
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
        else if (helpers.has(n.op)) {
          if (target === 'object') objectCall(helpers.get(n.op).index);
          else code.push(0x10,...uleb(helpers.get(n.op).index));
        }
        else if (Object.hasOwn(opcode, n.op)) code.push(opcode[n.op]);
        else switch (n.op) {
          case 'I32Const': case 'U32Const': code.push(...i32(n.value)); break;
          case 'I64Const': case 'U64Const': code.push(...i64(n.value)); break;
          case 'ValueString':
            if (target === 'object') objectCall(helpers.get(stringSupport.literals.get(n.value).name).index);
            else code.push(0x10,...uleb(helpers.get(stringSupport.literals.get(n.value).name).index));
            break;
          case 'ValueNull': code.push(...i64(VALUE_NULL)); break;
          case 'ValueUndefined': code.push(...i64(VALUE_UNDEFINED)); break;
          case 'F64Const': code.push(...f64(n.value)); break;
          case 'F64Identity': break;
          case 'I32BitNot': code.push(...i32(-1), 0x73); break;
          case 'F64Truthy':
            code.push(...f64(0), 0x62, ...read(n.args[0]), ...read(n.args[0]), 0x61, 0x71); break;
          case 'F64ToInt32': case 'F64ToUint32':
            if (target === 'object') objectCall(conversionIndex);
            else code.push(0x10, ...uleb(conversionIndex));
            break;
          case 'DirectCall':
            if (target === 'object') objectCall(imports.length + mod.functions.findIndex(f => f.name === n.callee));
            else code.push(0x10, ...uleb(functionIds.get(n.callee)));
            break;
          case 'ArgumentCount': case 'ArgumentNumber':
          case 'PrintNumber': case 'PrintBoolean':
            if (target === 'object') objectCall(intrinsicIndices.get(n.op));
            else code.push(0x10, ...uleb(intrinsicIndices.get(n.op)));
            break;
          default: throw new TypeError(`Wasm: unsupported operation ${n.op}`);
        }
        if (n.id !== null) {
          const setValue = set(ids.get(n.id));
          code.push(...setValue, ...sync(n.id, setValue.length));
        }
      }
      const t = b.terminator;
      if (t.op === 'Return') {
        if (heapEnabled) {
          if (t.value !== null) code.push(...read(t.value),...set(returned));
          code.push(...get(frame), ...i32(rootIds.length));
          if (target === 'object') objectCall(helpers.get('RootLeave').index);
          else code.push(0x10, ...uleb(helpers.get('RootLeave').index));
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
    if (target !== 'object') return body(locals, code);
    const localDecls = vector(locals.map(t => [1, types[t]]));
    const contents = [...localDecls, ...code, 0x0b];
    for (const call of objectRelocations.slice(objectCallStart)) {
      call.bodyOffset = uleb(contents.length).length + localDecls.length + call.codeOffset;
    }
    return [...uleb(contents.length), ...contents];
  });
  let objectMarker = 0;
  const call = name => {
    const index = helpers.has(name) ? helpers.get(name).index : intrinsicIndices.get(name);
    if (target !== 'object') return [0x10, ...uleb(index)];
    const marker = 0x70000000 + objectMarker++;
    pendingHelperCalls.push({ marker, symbolIndex: index });
    return [0x10, ...paddedUleb32(marker)];
  };
  const pendingHelperCalls = [];
  for (const spec of helpers.values()) {
    const helperBody = spec.emit(call);
    if (target === 'object') {
      const bodyIndex = bodies.length;
      for (const pending of pendingHelperCalls.splice(0)) {
        const pattern = [0x10, ...paddedUleb32(pending.marker)];
        const offset = helperBody.findIndex((_, i) => pattern.every((byte, j) => helperBody[i + j] === byte));
        if (offset < 0 || helperBody.findIndex((_, i) => i > offset && pattern.every((byte, j) => helperBody[i + j] === byte)) >= 0)
          throw new TypeError(`Wasm object: failed to locate helper call marker ${pending.marker}`);
        helperBody.splice(offset, pattern.length, 0x10, ...paddedUleb32(pending.symbolIndex));
        objectRelocations.push({ bodyIndex, bodyOffset: offset + 1, symbolIndex: pending.symbolIndex, type: 0 });
      }
      for (const [marker, ref] of objectGlobalRefs) {
        const pattern = [ref.opcode, ...paddedUleb32(marker)];
        const offset = helperBody.findIndex((_, i) => pattern.every((byte, j) => helperBody[i + j] === byte));
        if (offset < 0) continue;
        if (helperBody.findIndex((_, i) => i > offset && pattern.every((byte, j) => helperBody[i + j] === byte)) >= 0)
          throw new TypeError(`Wasm object: duplicate global marker ${marker}`);
        helperBody.splice(offset + 1, 5, ...paddedUleb32(ref.index));
        objectRelocations.push({ bodyIndex, bodyOffset: offset + 1, symbolIndex: imports.length + mod.functions.length + helpers.size + ref.index, type: 7 });
      }
    }
    bodies.push(helperBody);
  }
  if (needsConversion) bodies.push(toInt32Body());
  const exports = target === 'object' ? [] : target === 'component-core'
    ? [[...string('cm32p2||main'), 0, ...uleb(functionIds.get('main'))]]
    : mod.functions.map(f => [...string(f.name), 0, ...uleb(functionIds.get(f.name))]);
  const names = mod.functions.map(f => [...uleb(functionIds.get(f.name)), ...string(f.name)]);
  for (const [name,spec] of helpers) names.push([...uleb(spec.index),...string(name)]);
  if (needsConversion) names.push([...uleb(conversionIndex), ...string('js_to_int32')]);
  const namePayload = vector(names);
  const moduleImports = [...imports];
  if (heapEnabled) moduleImports.push([...string(target==='command-adapter'?'__main_module__':target==='object'?'env':'porffor'),...string(target==='object'?'__linear_memory':'memory'),2,0,0]);
  const globals = heapEnabled ? section(6,vector(Array.from({length:stringSupport.globalCount},()=>[0x7f,1,...i32(0),0x0b]))) : [];
  const module = [
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector(signatures)), ...section(2, vector(moduleImports)),
    ...section(3, vector(functionTypes)), ...globals,
    ...(target === 'object' ? [] : section(7, vector(exports))),
    ...section(10, vector(bodies)),
  ];
  if (target === 'object') {
    // Initial relocatable-object slice: one main function, scalar f64 code and
    // direct calls to imported runtime print_number. Each function index operand
    // is padded and receives a R_WASM_FUNCTION_INDEX_LEB relocation.
    const symbols = [];
    for (let i = 0; i < imports.length; i++) symbols.push([0, ...uleb(0x10), ...uleb(i)]);
    for (let i = 0; i < mod.functions.length; i++) {
      const f = mod.functions[i];
      symbols.push([0, ...uleb(f.name === 'main' ? 0x20 : 0x02), ...uleb(imports.length + i), ...string(f.name)]);
    }
    for (let i = 0; i < helpers.size; i++) {
      const spec = [...helpers.values()][i];
      symbols.push([0, ...uleb(0x02), ...uleb(imports.length + mod.functions.length + i), ...string(spec.name)]);
    }
    if (needsConversion) symbols.push([0, ...uleb(0x02), ...uleb(conversionIndex), ...string('js_to_int32')]);
    for (let i = 0; i < (stringSupport?.globalCount ?? 0); i++)
      symbols.push([2, ...uleb(0x02), ...uleb(i), ...string(`porffor_global_${i}`)]);
    const symbolSubsection = vector(symbols);
    const linking = [2, 8, ...uleb(symbolSubsection.length), ...symbolSubsection];
    const codePrefixLength = uleb(bodies.length).length;
    const relocations = objectRelocations.map(call => ({
      type: call.type,
      offset: codePrefixLength
        + bodies.slice(0, call.bodyIndex ?? call.functionIndex).reduce((n, b) => n + b.length, 0)
        + call.bodyOffset,
      symbolIndex: call.symbolIndex
    })).sort((a, b) => a.offset - b.offset)
      .map(({ type, offset, symbolIndex }) => [type, ...uleb(offset), ...uleb(symbolIndex)]);
    // Relocation sections refer to the zero-based non-custom section ordinal.
    const codeSectionIndex = 3 + (globals.length ? 1 : 0);
    const relocationPayload = [...uleb(codeSectionIndex), ...vector(relocations)];
    module.push(...section(0, [...string('linking'), ...linking]));
    module.push(...section(0, [...string('reloc.CODE'), ...relocationPayload]));
  }
  module.push(...section(0, [...string('name'), 1, ...uleb(namePayload.length), ...namePayload]));
  return Uint8Array.from(module);
}
