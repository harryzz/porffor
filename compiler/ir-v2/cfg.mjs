// Experimental only. Cross-block values must travel through block parameters.
export const parameter = (id, type) => ({ id, type });
export const instruction = (id, op, type, args = [], attributes = {}) =>
  ({ id, op, type, args, ...attributes });
export const block = (id, params, instructions, terminator) =>
  ({ id, params, instructions, terminator });
export const func = (name, params, result, entry, blocks) =>
  ({ name, params, result, entry, blocks });
export const module = (layer, functions) => ({ layer, functions });
export const returnValue = (value = null) => ({ op: 'Return', value });
export const branch = (target, args = []) => ({ op: 'Branch', target, args });
export const conditionalBranch = (condition, thenTarget, thenArgs, elseTarget, elseArgs) =>
  ({ op: 'ConditionalBranch', condition, thenTarget, thenArgs, elseTarget, elseArgs });

const fail = message => { throw new TypeError(`IR: ${message}`); };
const check = (ok, message) => { if (!ok) fail(message); };
const array = (x, label) => check(Array.isArray(x), `${label} must be an array`);
const name = x => check(typeof x === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(x), 'invalid identifier');
const shape = (x, keys) => {
  check(x !== null && typeof x === 'object' && !Array.isArray(x), 'expected node object');
  check(Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k)),
    `expected fields: ${keys.join(', ')}`);
};

export function validateModule(mod, spec) {
  shape(mod, ['layer', 'functions']);
  check(mod.layer === spec.layer, 'wrong IR layer');
  array(mod.functions, 'functions');
  const functions = new Map();
  const type = (t, allowNone = false) => check(spec.types.includes(t) && (allowNone || t !== 'none'), `invalid type ${t}`);
  const params = ps => {
    array(ps, 'parameters');
    for (const p of ps) { shape(p, ['id', 'type']); name(p.id); type(p.type); }
  };
  for (const f of mod.functions) {
    shape(f, ['name', 'params', 'result', 'entry', 'blocks']);
    name(f.name); params(f.params); type(f.result, true); name(f.entry); array(f.blocks, 'blocks');
    check(!functions.has(f.name), `duplicate function ${f.name}`);
    functions.set(f.name, f);
  }
  for (const f of mod.functions) {
    const blocks = new Map(), ids = new Set();
    const define = p => { check(!ids.has(p.id), `duplicate value ${p.id}`); ids.add(p.id); };
    f.params.forEach(define);
    for (const b of f.blocks) {
      shape(b, ['id', 'params', 'instructions', 'terminator']);
      name(b.id); params(b.params); array(b.instructions, 'instructions');
      check(!blocks.has(b.id), `duplicate block ${b.id}`); blocks.set(b.id, b);
      b.params.forEach(define);
    }
    check(blocks.has(f.entry), 'missing entry block');
    check(blocks.get(f.entry).params.length === 0, 'entry block cannot have parameters');
    const edges = new Map();
    for (const b of f.blocks) {
      // Function parameters dominate all blocks; other values are block-local.
      const values = new Map([...f.params, ...b.params].map(p => [p.id, p.type]));
      const use = id => { name(id); check(values.has(id), `undefined or nonlocal value ${id}`); return values.get(id); };
      const argumentsMatch = (args, expected) => {
        array(args, 'arguments'); check(args.length === expected.length, 'argument count mismatch');
        for (let i = 0; i < args.length; i++)
          check(use(args[i]) === expected[i], `argument type mismatch at ${i}`);
      };
      for (const n of b.instructions) {
        check(n !== null && typeof n === 'object', 'malformed instruction');
        check(Object.hasOwn(spec.ops, n.op), `unknown operation ${n.op}`);
        const op = spec.ops[n.op];
        shape(n, ['id', 'op', 'type', 'args', ...(op.fields ?? [])]); type(n.type, true);
        if (op.call) {
          name(n.callee); check(functions.has(n.callee), `unknown callee ${n.callee}`);
          const callee = functions.get(n.callee);
          argumentsMatch(n.args, callee.params.map(p => p.type));
          check(n.type === callee.result, 'call result type mismatch');
        } else {
          if (op.variadic) {
            array(n.args, 'arguments');
            for (const arg of n.args) check(use(arg) === op.variadic, 'variadic argument type mismatch');
          } else argumentsMatch(n.args, op.args);
          check(n.type === op.result, `result type mismatch for ${n.op}`);
          if (op.literal) check(op.literal(n[op.literalField ?? 'value']), `invalid literal for ${n.op}`);
        }
        if (n.type === 'none') check(n.id === null, 'void instruction cannot define a value');
        else { name(n.id); define(n); values.set(n.id, n.type); }
      }
      const t = b.terminator;
      check(t !== null && typeof t === 'object', 'missing terminator');
      const successors = [];
      const edge = (target, args) => {
        name(target); check(blocks.has(target), `invalid control-flow edge ${target}`);
        check(target !== f.entry, 'cannot branch to entry');
        argumentsMatch(args, blocks.get(target).params.map(p => p.type)); successors.push(target);
      };
      switch (t.op) {
        case 'Return':
          shape(t, ['op', 'value']);
          if (f.result === 'none') check(t.value === null, 'void return must have no value');
          else check(use(t.value) === f.result, 'return type mismatch');
          break;
        case 'Branch': shape(t, ['op', 'target', 'args']); edge(t.target, t.args); break;
        case 'ConditionalBranch':
          shape(t, ['op', 'condition', 'thenTarget', 'thenArgs', 'elseTarget', 'elseArgs']);
          check(use(t.condition) === spec.condition, 'condition type mismatch');
          edge(t.thenTarget, t.thenArgs); edge(t.elseTarget, t.elseArgs); break;
        default: fail(`unknown terminator ${t.op}`);
      }
      edges.set(b.id, successors);
    }
    const reached = new Set(), todo = [f.entry];
    while (todo.length) {
      const id = todo.pop(); if (reached.has(id)) continue;
      reached.add(id); todo.push(...edges.get(id));
    }
    check(reached.size === blocks.size, 'unreachable block');
  }
  return mod;
}
