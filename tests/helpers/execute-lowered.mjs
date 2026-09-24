// Test oracle only. Production will emit core Wasm, never execute this interpreter.
import { numericArguments } from '../../scripts/numeric-arguments.mjs';
import { validate } from '../../compiler/ir-v2/lowered.mjs';

export function executeLowered(mod, { maxSteps = 100000, arguments: args = [] } = {}) {
  validate(mod);
  const host = numericArguments(args);
  const functions = new Map(mod.functions.map(f => [f.name, f]));
  const output = [];
  let steps = 0;
  const tick = () => { if (++steps > maxSteps) throw new Error('IR test execution exceeded step budget'); };
  const invoke = (name, args) => {
    tick();
    const f = functions.get(name);
    if (!f || f.params.length !== args.length) throw new Error('Invalid test entry/call');
    const parameters = new Map(f.params.map((p, i) => [p.id, args[i]]));
    const blocks = new Map(f.blocks.map(b => [b.id, b]));
    let block = blocks.get(f.entry), incoming = [];
    while (true) {
      tick();
      const values = new Map(parameters);
      block.params.forEach((p, i) => values.set(p.id, incoming[i]));
      for (const n of block.instructions) {
        tick();
        const [a, b, c] = n.args.map(id => values.get(id));
        let value;
        switch (n.op) {
          case 'F64Const': case 'I32Const': value = n.value; break;
          case 'F64ToInt32': value = a | 0; break;
          case 'F64ToUint32': value = a >>> 0; break;
          case 'I32ToF64': case 'U32ToF64': value = a; break;
          case 'I32BitNot': value = ~a; break;
          case 'I32BitAnd': value = a & b; break;
          case 'I32BitOr': value = a | b; break;
          case 'I32BitXor': value = a ^ b; break;
          case 'I32ShiftLeft': value = a << (b & 31); break;
          case 'I32ShiftRight': value = a >> (b & 31); break;
          case 'U32ShiftRight': value = a >>> (b & 31); break;
          case 'I32Multiply': value = Math.imul(a, b); break;
          case 'F64Add': value = a + b; break;
          case 'F64Subtract': value = a - b; break;
          case 'F64Multiply': value = a * b; break;
          case 'F64Divide': value = a / b; break;
          case 'F64Negate': value = -a; break;
          case 'F64Identity': value = a; break;
          case 'F64Truthy': value = a !== 0 && !Number.isNaN(a) ? 1 : 0; break;
          case 'F64Equal': case 'I32Equal': value = a === b ? 1 : 0; break;
          case 'F64NotEqual': value = a !== b ? 1 : 0; break;
          case 'F64LessThan': value = a < b ? 1 : 0; break;
          case 'F64LessEqual': value = a <= b ? 1 : 0; break;
          case 'F64GreaterThan': value = a > b ? 1 : 0; break;
          case 'F64GreaterEqual': value = a >= b ? 1 : 0; break;
          case 'DirectCall': value = invoke(n.callee, n.args.map(id => values.get(id))); break;
          // Reference interpreter keeps boxed primitives as native JS values,
          // independently of the backend's bit encoding.
          case 'ValueString': value = n.value; break;
          case 'StringLength': value = a.length; break;
          case 'ValueLength': value = a.length; break;
          case 'ArrayCreate': value = new Array(a).fill(undefined); break;
          case 'Uint8ArrayCreate': value = new Uint8Array(a); break;
          case 'ValueGetIndex': value = a[b]; break;
          case 'ValueSetIndex': a[b]=c;value=c;break;
          case 'ObjectCreate': value={properties:new Map(),prototype:b};break;
          case 'ValueGetProperty': {let obj=a;value=b==='length'&&(typeof a==='string'||Array.isArray(a)||ArrayBuffer.isView(a))?a.length:undefined;while(obj&&obj.properties){if(obj.properties.has(b)){value=obj.properties.get(b);break;}obj=obj.prototype;}break;}
          case 'ValueSetProperty': a.properties.set(b,c);value=c;break;
          case 'ValueAdd': value = a + b; break;
          case 'ValueNull': value = null; break;
          case 'ValueUndefined': value = undefined; break;
          case 'ValueBoxNumber': value = a; break;
          case 'ValueBoxBoolean': value = a !== 0; break;
          case 'ValueToNumber': value = Number(a); break;
          case 'ValueUnboxNumber':
            if (typeof a !== 'number') throw new Error('Expected boxed number');
            value = a; break;
          case 'ValueTruthy': value = a ? 1 : 0; break;
          case 'ValueStrictEqual': value = a === b ? 1 : 0; break;
          case 'PrintValue': output.push(a); break;
          case 'ArgumentCount': value = host.argument_count(); break;
          case 'ArgumentNumber': value = host.argument_number(a); break;
          case 'PrintNumber': output.push(a); break;
          case 'PrintBoolean': output.push(a !== 0); break;
          default: throw new Error(`Unimplemented test operation: ${n.op}`);
        }
        if (n.id !== null) values.set(n.id, value);
      }
      const t = block.terminator;
      if (t.op === 'Return') return t.value === null ? undefined : values.get(t.value);
      const taken = t.op === 'Branch' || values.get(t.condition) !== 0;
      const target = t.op === 'Branch' ? t.target : taken ? t.thenTarget : t.elseTarget;
      const edgeArgs = t.op === 'Branch' ? t.args : taken ? t.thenArgs : t.elseArgs;
      // Read all arguments before binding any destination parameters (parallel phi assignment).
      incoming = edgeArgs.map(id => values.get(id));
      block = blocks.get(target);
    }
  };
  invoke('main', []);
  return output;
}
