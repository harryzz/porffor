// Deliberately separate from monomorphic numeric lowering. All source values here
// are boxed primitives; no unknown string/object input can reach numeric coercion.
import * as S from './semantic.mjs';
import * as L from './lowered.mjs';
import { checkHeapUses } from './string-facts.mjs';
const numeric = new Map([
  ['JsAdd','F64Add'], ['JsSubtract','F64Subtract'], ['JsMultiply','F64Multiply'], ['JsDivide','F64Divide'],
  ['JsNegate','F64Negate'], ['JsPositive','F64Identity'],
  ['JsLessThan','F64LessThan'], ['JsLessEqual','F64LessEqual'], ['JsGreaterThan','F64GreaterThan'], ['JsGreaterEqual','F64GreaterEqual']
]);
const integer = new Map([
  ['JsBitAnd','I32BitAnd'], ['JsBitOr','I32BitOr'], ['JsBitXor','I32BitXor'], ['JsBitNot','I32BitNot'],
  ['JsShiftLeft','I32ShiftLeft'], ['JsShiftRight','I32ShiftRight'], ['JsUnsignedShiftRight','U32ShiftRight'], ['JsImul','I32Multiply']
]);
export function lowerPrimitives(mod) {
  S.validate(mod);
  const heap = mod.functions.some(f=>f.blocks.some(b=>b.instructions.some(n=>['JsString','JsStringLength','JsArray','JsUint8Array','JsObject','JsIndexGet','JsIndexSet','JsPropertyGet','JsPropertySet','JsDynamicPropertyGet','JsDynamicPropertySet'].includes(n.op))));
  if (heap) checkHeapUses(mod);
  const functions = mod.functions.map(f => {
    const used = new Set([...f.params,...f.blocks.flatMap(b=>[...b.params,...b.instructions])].map(n=>n.id));
    let serial = 0;
    const fresh = () => { let id; do {id=`primitive${serial++}`;} while(used.has(id)); used.add(id); return id; };
    const parameter = p => L.parameter(p.id,'jsval');
    const blocks = f.blocks.map(b => {
      const instructions = [];
      const emit = (id,op,type,args=[],attributes={}) => { instructions.push(L.instruction(id,op,type,args,attributes)); return id; };
      const number = id => emit(fresh(),'ValueToNumber','f64',[id]);
      const boxNumber = (id,value) => emit(id,'ValueBoxNumber','jsval',[value]);
      const boxBoolean = (id,value) => emit(id,'ValueBoxBoolean','jsval',[value]);
      const invert = value => emit(fresh(),'I32Equal','i32',[value,emit(fresh(),'I32Const','i32',[],{value:0})]);
      for (const n of b.instructions) {
        if (n.op === 'JsNumber') boxNumber(n.id,emit(fresh(),'F64Const','f64',[],{value:n.value}));
        else if (n.op === 'JsBoolean') boxBoolean(n.id,emit(fresh(),'I32Const','i32',[],{value:n.value?1:0}));
        else if (n.op === 'JsNull' || n.op === 'JsUndefined') emit(n.id,n.op === 'JsNull'?'ValueNull':'ValueUndefined','jsval');
        else if (n.op === 'JsString') emit(n.id,'ValueString','jsval',[],{value:n.value});
        else if (n.op === 'JsStringLength') boxNumber(n.id,emit(fresh(),'ValueLength','f64',[...n.args]));
        else if (n.op === 'JsArray') {
          emit(n.id,'ArrayCreate','jsval',[emit(fresh(),'F64Const','f64',[],{value:n.args.length})]);
          for(let i=0;i<n.args.length;i++)emit(fresh(),'ValueSetIndex','jsval',[n.id,emit(fresh(),'ValueBoxNumber','jsval',[emit(fresh(),'F64Const','f64',[],{value:i})]),n.args[i]]);
        }
        else if (n.op === 'JsUint8Array') emit(n.id,'Uint8ArrayCreate','jsval',[number(n.args[0])]);
        else if (n.op === 'JsObject') {
          if(n.keys.length!==n.args.length)throw new TypeError('Object lowering: property key/value count mismatch');
          emit(n.id,'ObjectCreate','jsval',[emit(fresh(),'F64Const','f64',[],{value:n.keys.length})]);
          for(let i=0;i<n.args.length;i++)emit(fresh(),'ValueSetProperty','jsval',[n.id,emit(fresh(),'ValueString','jsval',[],{value:n.keys[i]}),n.args[i]]);
        }
        else if (n.op === 'JsIndexGet') emit(n.id,'ValueGetIndex','jsval',[...n.args]);
        else if (n.op === 'JsIndexSet') emit(n.id,'ValueSetIndex','jsval',[...n.args]);
        else if (n.op === 'JsPropertyGet') emit(n.id,'ValueGetProperty','jsval',[n.args[0],emit(fresh(),'ValueString','jsval',[],{value:n.key})]);
        else if (n.op === 'JsPropertySet') emit(n.id,'ValueSetProperty','jsval',[n.args[0],emit(fresh(),'ValueString','jsval',[],{value:n.key}),n.args[1]]);
        else if (n.op === 'JsDynamicPropertyGet') emit(n.id,'ValueGetProperty','jsval',n.args);
        else if (n.op === 'JsDynamicPropertySet') emit(n.id,'ValueSetProperty','jsval',n.args);
        else if (heap && n.op === 'JsAdd') emit(n.id,'ValueAdd','jsval',[...n.args]);
        else if (numeric.has(n.op)) {
          const op = numeric.get(n.op), comparison = /Less|Greater/.test(op);
          const value = emit(fresh(),op,comparison?'i32':'f64',n.args.map(number));
          if (comparison) boxBoolean(n.id,value); else boxNumber(n.id,value);
        } else if (integer.has(n.op)) {
          const unsigned = n.op === 'JsUnsignedShiftRight';
          const args = n.args.map((id,i)=>emit(fresh(),unsigned&&i===0?'F64ToUint32':'F64ToInt32',unsigned&&i===0?'u32':'i32',[number(id)]));
          const value=emit(fresh(),integer.get(n.op),unsigned?'u32':'i32',args);
          boxNumber(n.id,emit(fresh(),unsigned?'U32ToF64':'I32ToF64','f64',[value]));
        } else if (n.op === 'JsStrictEqual' || n.op === 'JsStrictNotEqual') {
          let value = emit(fresh(),'ValueStrictEqual','i32',[...n.args]);
          if (n.op === 'JsStrictNotEqual') value=invert(value);
          boxBoolean(n.id,value);
        } else if (n.op === 'JsNot') boxBoolean(n.id,invert(emit(fresh(),'ValueTruthy','i32',[...n.args])));
        else if (n.op === 'JsPrint') emit(null,'PrintValue','none',[...n.args]);
        else if (n.op === 'JsArgumentCount') boxNumber(n.id,emit(fresh(),'ArgumentCount','f64'));
        else if (n.op === 'JsArgumentNumber') boxNumber(n.id,emit(fresh(),'ArgumentNumber','f64',n.args.map(id=>emit(fresh(),'ValueUnboxNumber','f64',[id]))));
        else if (n.op === 'JsDirectCall') emit(n.id,'DirectCall',n.type==='none'?'none':'jsval',[...n.args],{callee:n.callee});
        else throw new TypeError(`Primitive lowering: unsupported semantic operation ${n.op}`);
      }
      const t=b.terminator;
      const terminator = t.op==='Return'?L.returnValue(t.value):t.op==='Branch'?L.branch(t.target,[...t.args]):
        L.conditionalBranch(emit(fresh(),'ValueTruthy','i32',[t.condition]),t.thenTarget,[...t.thenArgs],t.elseTarget,[...t.elseArgs]);
      return L.block(b.id,b.params.map(parameter),instructions,terminator);
    });
    return L.func(f.name,f.params.map(parameter),f.result==='none'?'none':'jsval',f.entry,blocks);
  });
  return L.validate(L.module('lowered',functions));
}
