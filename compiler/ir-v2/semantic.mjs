import { validateModule } from './cfg.mjs';
export * from './cfg.mjs';

// value denotes a JavaScript value, without a physical representation.
const binary = () => ({ args: ['value', 'value'], result: 'value' });
const spec = {
  layer: 'semantic', types: ['none', 'value'], condition: 'value',
  ops: {
    JsString: { args: [], result: 'value', fields: ['value'], literal: x => typeof x === 'string' },
    JsStringLength: { args: ['value'], result: 'value' },
    JsObject: { variadic: 'value', result: 'value', fields: ['keys'], literalField:'keys', literal: x => Array.isArray(x) && x.every(k=>typeof k==='string') },
    JsObjectCreate: { args: ['value'], result: 'value' },
    JsClosureCreate: { args: ['value'], result: 'value', fields: ['callee'] },
    JsClosureCall: { variadic: 'value', result: 'value' },
    JsCaptureGet: { args: ['value'], result: 'value', fields: ['key'], literalField:'key', literal: x => typeof x==='string' },
    JsClosureArgument: { args: ['value'], result: 'value', fields:['index'], literalField:'index', literal:x=>Number.isInteger(x)&&x>=0 },
    JsPropertyGet: { args: ['value'], result: 'value', fields: ['key'], literalField:'key', literal: x => typeof x==='string' },
    JsPropertySet: { args: ['value','value'], result: 'value', fields: ['key'], literalField:'key', literal: x => typeof x==='string' },
    JsDynamicPropertyGet: { args: ['value','value'], result: 'value' },
    JsDynamicPropertySet: { args: ['value','value','value'], result: 'value' },
    JsArray: { variadic: 'value', result: 'value' },
    JsUint8Array: { args: ['value'], result: 'value' },
    JsIndexGet: { args: ['value', 'value'], result: 'value' },
    JsIndexSet: { args: ['value', 'value', 'value'], result: 'value' },
    JsNull: { args: [], result: 'value' },
    JsUndefined: { args: [], result: 'value' },
    JsNumber: { args: [], result: 'value', fields: ['value'], literal: x => typeof x === 'number' },
    JsBoolean: { args: [], result: 'value', fields: ['value'], literal: x => typeof x === 'boolean' },
    JsAdd: binary(), JsSubtract: binary(), JsMultiply: binary(), JsDivide: binary(),
    JsStrictEqual: binary(), JsStrictNotEqual: binary(),
    JsLessThan: binary(), JsLessEqual: binary(), JsGreaterThan: binary(), JsGreaterEqual: binary(),
    JsNegate: { args: ['value'], result: 'value' },
    JsPositive: { args: ['value'], result: 'value' },
    JsNot: { args: ['value'], result: 'value' },
    JsBitAnd: binary(), JsBitOr: binary(), JsBitXor: binary(),
    JsShiftLeft: binary(), JsShiftRight: binary(), JsUnsignedShiftRight: binary(), JsImul: binary(),
    JsBitNot: { args: ['value'], result: 'value' },
    JsArgumentCount: { args: [], result: 'value' },
    JsArgumentNumber: { args: ['value'], result: 'value' },
    JsPrint: { args: ['value'], result: 'none' },
    JsDirectCall: { call: true, fields: ['callee'] }
  }
};
export const validate = mod => validateModule(mod, spec);
