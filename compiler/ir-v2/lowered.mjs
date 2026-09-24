import { validateModule } from './cfg.mjs';
export * from './cfg.mjs';
import { printIntrinsics, argumentIntrinsics } from './intrinsics.mjs';

const ops = {
  ValueString: { args: [], result: 'jsval', fields: ['value'], literal: x => typeof x === 'string', effects: ['allocate', 'memory-read', 'memory-write', 'may-trap'] },
  ValueAdd: { args: ['jsval', 'jsval'], result: 'jsval', effects: ['allocate', 'memory-read', 'memory-write', 'may-trap'] },
  StringLength: { args: ['jsval'], result: 'f64', effects: ['memory-read', 'may-trap'] },
  ValueLength: { args: ['jsval'], result: 'f64', effects: ['memory-read', 'may-trap'] },
  ArrayCreate: { args: ['f64'], result: 'jsval', effects: ['allocate', 'memory-read', 'memory-write', 'may-trap'] },
  Uint8ArrayCreate: { args: ['f64'], result: 'jsval', effects: ['allocate', 'memory-read', 'memory-write', 'may-trap'] },
  ValueGetIndex: { args: ['jsval', 'jsval'], result: 'jsval', effects: ['memory-read', 'may-trap'] },
  ValueSetIndex: { args: ['jsval', 'jsval', 'jsval'], result: 'jsval', effects: ['memory-read', 'memory-write', 'may-trap'] },
  ObjectCreate: { args: ['f64','jsval'], result: 'jsval', effects: ['allocate', 'memory-read', 'memory-write', 'may-trap'] },
  ValueGetProperty: { args: ['jsval','jsval'], result: 'jsval', effects: ['memory-read', 'may-trap'] },
  ValueSetProperty: { args: ['jsval','jsval','jsval'], result: 'jsval', effects: ['memory-read','memory-write','may-trap'] },
  ValueNull: { args: [], result: 'jsval' },
  ValueUndefined: { args: [], result: 'jsval' },
  ValueBoxNumber: { args: ['f64'], result: 'jsval' },
  ValueBoxBoolean: { args: ['i32'], result: 'jsval' },
  ValueUnboxNumber: { args: ['jsval'], result: 'f64', effects: ['may-trap'] },
  ValueToNumber: { args: ['jsval'], result: 'f64', effects: ['may-trap'] },
  ValueTruthy: { args: ['jsval'], result: 'i32', effects: ['memory-read', 'may-trap'] },
  ValueStrictEqual: { args: ['jsval', 'jsval'], result: 'i32', effects: ['memory-read', 'may-trap'] },
  PrintValue: { args: ['jsval'], result: 'none', effects: ['host-write', 'memory-read', 'may-trap'] },
  DirectCall: { call: true, fields: ['callee'] }, ...printIntrinsics, ...argumentIntrinsics };
// Conversion is modulo 2^32, not trapping or saturating truncation.
ops.F64ToInt32 = { args: ['f64'], result: 'i32' };
ops.F64ToUint32 = { args: ['f64'], result: 'u32' };
ops.I32ToF64 = { args: ['i32'], result: 'f64' };
ops.U32ToF64 = { args: ['u32'], result: 'f64' };
ops.I32BitNot = { args: ['i32'], result: 'i32' };
for (const op of ['BitAnd', 'BitOr', 'BitXor', 'ShiftLeft', 'ShiftRight'])
  ops[`I32${op}`] = { args: ['i32', 'i32'], result: 'i32' };
ops.U32ShiftRight = { args: ['u32', 'i32'], result: 'u32' };
for (const op of ['Divide', 'LessEqual', 'GreaterThan', 'GreaterEqual', 'NotEqual']) {
  ops[`F64${op}`] = { args: ['f64', 'f64'], result: op === 'Divide' ? 'f64' : 'i32' };
}
for (const op of ['Negate', 'Identity', 'Truthy']) {
  ops[`F64${op}`] = { args: ['f64'], result: op === 'Truthy' ? 'i32' : 'f64' };
}
for (const [prefix, type, literal] of [
  ['I32', 'i32', x => Number.isInteger(x) && x >= -2147483648 && x <= 2147483647],
  ['U32', 'u32', x => Number.isInteger(x) && x >= 0 && x <= 4294967295],
  ['I64', 'i64', x => typeof x === 'bigint' && x >= -(1n << 63n) && x < (1n << 63n)],
  ['U64', 'u64', x => typeof x === 'bigint' && x >= 0n && x < (1n << 64n)],
  ['F64', 'f64', x => typeof x === 'number']
]) {
  ops[`${prefix}Const`] = { args: [], result: type, fields: ['value'], literal };
  for (const suffix of ['Add', 'Subtract', 'Multiply', 'Equal', 'LessThan']) {
    ops[`${prefix}${suffix}`] = {
      args: [type, type], result: ['Equal', 'LessThan'].includes(suffix) ? 'i32' : type
    };
  }
}
const spec = {
  layer: 'lowered',
  types: ['none', 'i32', 'u32', 'i64', 'u64', 'f64', 'jsval', 'linear-ptr'],
  condition: 'i32', ops
};
export const validate = mod => validateModule(mod, spec);
