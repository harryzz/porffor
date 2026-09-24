import * as S from './semantic.mjs';
import * as L from './lowered.mjs';

const arithmetic = new Map([
  ['JsAdd', 'F64Add'], ['JsSubtract', 'F64Subtract'], ['JsMultiply', 'F64Multiply'], ['JsDivide', 'F64Divide'],
  ['JsNegate', 'F64Negate'], ['JsPositive', 'F64Identity']
]);
const integer = new Map([
  ['JsBitAnd', 'I32BitAnd'], ['JsBitOr', 'I32BitOr'], ['JsBitXor', 'I32BitXor'],
  ['JsShiftLeft', 'I32ShiftLeft'], ['JsShiftRight', 'I32ShiftRight'],
  ['JsUnsignedShiftRight', 'U32ShiftRight'], ['JsBitNot', 'I32BitNot'], ['JsImul', 'I32Multiply']
]);
const argumentsOps = new Map([['JsArgumentCount', 'ArgumentCount'], ['JsArgumentNumber', 'ArgumentNumber']]);
const ordered = new Map([
  ['JsLessThan', 'F64LessThan'], ['JsLessEqual', 'F64LessEqual'],
  ['JsGreaterThan', 'F64GreaterThan'], ['JsGreaterEqual', 'F64GreaterEqual']
]);
const equality = new Set(['JsStrictEqual', 'JsStrictNotEqual']);
const error = message => { throw new TypeError(`Numeric lowering: ${message}`); };

// Monomorphic constraints on values, block arguments and function signatures.
// Literal seeds and numeric operation requirements establish the closed-program
// contract. Incompatible Number/Boolean flows are rejected, never truncated.
class Facts {
  constructor() { this.parents = new Map(); this.types = new Map(); }
  root(id) {
    if (!this.parents.has(id)) this.parents.set(id, id);
    const parent = this.parents.get(id);
    if (parent !== id) this.parents.set(id, this.root(parent));
    return this.parents.get(id);
  }
  require(id, type) {
    const root = this.root(id), previous = this.types.get(root);
    if (previous && previous !== type) error(`incompatible number/boolean flow at ${id}`);
    this.types.set(root, type);
  }
  join(a, b) {
    a = this.root(a); b = this.root(b);
    if (a === b) return;
    const type = this.types.get(b);
    if (type) this.require(a, type);
    this.parents.set(b, a);
  }
  get(id) {
    const type = this.types.get(this.root(id));
    if (!type) error(`cannot infer number/boolean type for ${id}`);
    return type;
  }
}

export function lowerSemantic(mod) {
  S.validate(mod);
  const facts = new Facts(), funcs = new Map(mod.functions.map(f => [f.name, f]));
  const key = (f, id) => `${f.name}:${id}`;
  const result = f => `${f.name}:$return`;
  for (const f of mod.functions) {
    const blocks = new Map(f.blocks.map(b => [b.id, b]));
    const require = (id, type) => facts.require(key(f, id), type);
    const edge = (target, args) => args.forEach((id, i) => facts.join(key(f, id), key(f, blocks.get(target).params[i].id)));
    for (const b of f.blocks) {
      for (const n of b.instructions) {
        if (n.op === 'JsNumber') require(n.id, 'number');
        else if (n.op === 'JsBoolean') require(n.id, 'boolean');
        else if (arithmetic.has(n.op) || ordered.has(n.op) || integer.has(n.op) || argumentsOps.has(n.op)) {
          n.args.forEach(id => require(id, 'number'));
          require(n.id, ordered.has(n.op) ? 'boolean' : 'number');
        } else if (equality.has(n.op) || n.op === 'JsNot') require(n.id, 'boolean');
        else if (n.op === 'JsDirectCall') {
          const callee = funcs.get(n.callee);
          n.args.forEach((id, i) => facts.join(key(f, id), key(callee, callee.params[i].id)));
          if (n.type !== 'none') facts.join(key(f, n.id), result(callee));
        } else if (n.op !== 'JsPrint') error(`unsupported semantic operation ${n.op}`);
      }
      const t = b.terminator;
      if (t.op === 'Return' && t.value !== null) facts.join(key(f, t.value), result(f));
      else if (t.op === 'Branch') edge(t.target, t.args);
      else if (t.op === 'ConditionalBranch') { edge(t.thenTarget, t.thenArgs); edge(t.elseTarget, t.elseArgs); }
    }
  }
  const representation = t => t === 'number' ? 'f64' : 'i32';
  const functions = mod.functions.map(f => {
    const fact = id => facts.get(key(f, id));
    const type = id => representation(fact(id));
    const param = p => L.parameter(p.id, type(p.id));
    const used = new Set([...f.params, ...f.blocks.flatMap(b => [...b.params, ...b.instructions])].map(n => n.id));
    let serial = 0;
    const fresh = () => { let id; do { id = `lower${serial++}`; } while (used.has(id)); used.add(id); return id; };
    const blocks = f.blocks.map(b => {
      const instructions = [];
      const emit = (id, op, type, args = [], attributes = {}) => {
        instructions.push(L.instruction(id, op, type, args, attributes)); return id;
      };
      const truthy = id => fact(id) === 'boolean' ? id : emit(fresh(), 'F64Truthy', 'i32', [id]);
      const not = (id, value) => {
        const zero = emit(fresh(), 'I32Const', 'i32', [], { value: 0 });
        emit(id, 'I32Equal', 'i32', [value, zero]);
      };
      for (const n of b.instructions) {
        if (n.op === 'JsNumber') emit(n.id, 'F64Const', 'f64', [], { value: n.value });
        else if (n.op === 'JsBoolean') emit(n.id, 'I32Const', 'i32', [], { value: n.value ? 1 : 0 });
        else if (argumentsOps.has(n.op)) emit(n.id, argumentsOps.get(n.op), 'f64', [...n.args]);
        else if (arithmetic.has(n.op)) emit(n.id, arithmetic.get(n.op), 'f64', [...n.args]);
        else if (integer.has(n.op)) {
          const unsigned = n.op === 'JsUnsignedShiftRight';
          const args = n.args.map((id, i) => emit(fresh(), unsigned && i === 0 ? 'F64ToUint32' : 'F64ToInt32', unsigned && i === 0 ? 'u32' : 'i32', [id]));
          const result = emit(fresh(), integer.get(n.op), unsigned ? 'u32' : 'i32', args);
          // JavaScript bitwise and imul results are Numbers, not Booleans.
          emit(n.id, unsigned ? 'U32ToF64' : 'I32ToF64', 'f64', [result]);
        }
        else if (ordered.has(n.op)) emit(n.id, ordered.get(n.op), 'i32', [...n.args]);
        else if (equality.has(n.op)) {
          const different = fact(n.args[0]) !== fact(n.args[1]), inverted = n.op === 'JsStrictNotEqual';
          if (different) emit(n.id, 'I32Const', 'i32', [], { value: inverted ? 1 : 0 });
          else {
            const op = fact(n.args[0]) === 'number' ? 'F64Equal' : 'I32Equal';
            const id = emit(inverted ? fresh() : n.id, op, 'i32', [...n.args]);
            if (inverted) not(n.id, id);
          }
        } else if (n.op === 'JsNot') not(n.id, truthy(n.args[0]));
        else if (n.op === 'JsPrint') emit(null, fact(n.args[0]) === 'number' ? 'PrintNumber' : 'PrintBoolean', 'none', [...n.args]);
        else if (n.op === 'JsDirectCall') emit(n.id, 'DirectCall', n.type === 'none' ? 'none' : type(n.id), [...n.args], { callee: n.callee });
        else error(`unsupported semantic operation ${n.op}`);
      }
      const t = b.terminator;
      let terminator;
      if (t.op === 'Return') terminator = L.returnValue(t.value);
      else if (t.op === 'Branch') terminator = L.branch(t.target, [...t.args]);
      else terminator = L.conditionalBranch(truthy(t.condition), t.thenTarget, [...t.thenArgs], t.elseTarget, [...t.elseArgs]);
      return L.block(b.id, b.params.map(param), instructions, terminator);
    });
    return L.func(f.name, f.params.map(param), f.result === 'none' ? 'none' : representation(facts.get(result(f))), f.entry, blocks);
  });
  return L.validate(L.module('lowered', functions));
}
