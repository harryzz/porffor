// Directly emitted core-Wasm helpers. No boxed-value evaluation is delegated to a host.
import { body, get, i32, i64, f64 } from './encoding.mjs';
import { VALUE_PATTERN, VALUE_UNDEFINED, VALUE_NULL, VALUE_FALSE, VALUE_TRUE, CANONICAL_NAN } from '../../runtime-v2/value-layout.mjs';
const number = index => [...get(index),...i64(VALUE_PATTERN),0x83,...i64(VALUE_PATTERN),0x52]; // (bits & pattern) != pattern
const equals = (index,value) => [...get(index),...i64(value),0x51];
const retIf = (condition,value) => [...condition,0x04,0x40,...value,0x0f,0x0b];
export const primitiveHelpers = {
  ValueBoxNumber: {
    params:['f64'],result:'jsval',
    emit:()=>body([], [
      ...get(0),...get(0),0x61,0x04,0x7e,
      ...get(0),0xbd,0x05,...i64(CANONICAL_NAN),0x0b
    ])
  },
  ValueBoxBoolean: {
    params:['i32'],result:'jsval',
    emit:()=>body([], [...get(0),0x45,0x45,0xad,...i64(VALUE_FALSE),0x84])
  },
  ValueToNumber: {
    params:['jsval'],result:'f64',
    emit:()=>body([], [
      ...retIf(number(0),[...get(0),0xbf]),
      ...retIf(equals(0,VALUE_UNDEFINED),f64(NaN)),
      ...retIf(equals(0,VALUE_NULL),f64(0)),
      ...retIf(equals(0,VALUE_FALSE),f64(0)),
      ...retIf(equals(0,VALUE_TRUE),f64(1)),
      0x00 // unsupported/malformed runtime value, never silently coerce a heap value
    ])
  },
  ValueUnboxNumber: {
    params:['jsval'],result:'f64',
    emit:()=>body([], [...retIf(number(0),[...get(0),0xbf]),0x00])
  },
  ValueTruthy: {
    params:['jsval'],result:'i32',dependencies:['ValueToNumber'],
    emit:call=>body([], [
      ...get(0),...call('ValueToNumber'),...f64(0),0x62,
      ...get(0),...call('ValueToNumber'),...get(0),...call('ValueToNumber'),0x61,0x71
    ])
  },
  ValueStrictEqual: {
    params:['jsval','jsval'],result:'i32',dependencies:['ValueToNumber'],
    emit:call=>body([], [
      // Validate primitive tags even when types differ or values are identical.
      ...get(0),...call('ValueToNumber'),0x1a,...get(1),...call('ValueToNumber'),0x1a,
      ...number(0),...number(1),0x71,0x04,0x7f,
      ...get(0),0xbf,...get(1),0xbf,0x61,
      0x05,...get(0),...get(1),0x51,0x0b
    ])
  },
  PrintValue: {
    params:['jsval'],result:'none',
    emit:call=>body([], [
      ...retIf(number(0),[...get(0),0xbf,...call('PrintNumber')]),
      ...retIf(equals(0,VALUE_UNDEFINED),call('PrintUndefined')),
      ...retIf(equals(0,VALUE_NULL),call('PrintNull')),
      ...retIf(equals(0,VALUE_FALSE),[...i32(0),...call('PrintBoolean')]),
      ...retIf(equals(0,VALUE_TRUE),[...i32(1),...call('PrintBoolean')]),0x00
    ])
  }
};
