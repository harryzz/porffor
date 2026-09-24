import parse from '../parser/index.js';
import analyzeBindings from '../semantic.js';
import * as S from './semantic.mjs';

const binaryOps = new Map([
  ['+', 'JsAdd'], ['-', 'JsSubtract'], ['*', 'JsMultiply'], ['/', 'JsDivide'],
  ['<', 'JsLessThan'], ['<=', 'JsLessEqual'], ['>', 'JsGreaterThan'], ['>=', 'JsGreaterEqual'],
  ['===', 'JsStrictEqual'], ['!==', 'JsStrictNotEqual'],
  ['&', 'JsBitAnd'], ['|', 'JsBitOr'], ['^', 'JsBitXor'],
  ['<<', 'JsShiftLeft'], ['>>', 'JsShiftRight'], ['>>>', 'JsUnsignedShiftRight']
]);
const unaryOps = new Map([['-', 'JsNegate'], ['+', 'JsPositive'], ['!', 'JsNot'], ['~', 'JsBitNot']]);
export class SubsetError extends SyntaxError {
  constructor(node, message) {
    super(`Numeric subset at offset ${node?.start ?? 0}: ${message}`);
    this.name = 'SubsetError';
  }
}
const reject = (node, message) => { throw new SubsetError(node, message); };

// Check the whole source, including dead code, before invoking legacy analysis.
function checkSyntax(node, topLevel = false, dynamic = false) {
  const child = n => { if (n) checkSyntax(n, false, dynamic); };
  if (node.typeAnnotation || node.returnType || node.typeParameters || node.optional)
    reject(node, 'type annotations, generics and optional operations are not supported');
  switch (node.type) {
    case 'Program': node.body.forEach(n => checkSyntax(n, true, dynamic)); break;
    case 'BlockStatement': node.body.forEach(child); break;
    case 'EmptyStatement': break;
    case 'FunctionDeclaration':
      if (dynamic && ['undefined','NaN','Infinity'].includes(node.id?.name)) reject(node, 'function conflicts with a protected global');
      if (!topLevel || node.async || node.generator) reject(node, 'only top-level synchronous functions are supported');
      node.params.forEach(p => {
        if (p.type !== 'Identifier') reject(p, 'only simple parameters are supported');
        child(p);
      });
      child(node.body); break;
    case 'VariableDeclaration':
      if (!['let', 'const'].includes(node.kind)) reject(node, 'use initialized let/const declarations; var is unsupported');
      node.declarations.forEach(d => {
        if (dynamic && topLevel && ['undefined','NaN','Infinity'].includes(d.id.name)) reject(d, 'top-level lexical declaration conflicts with a protected global');
        if (d.id.type !== 'Identifier' || (!d.init && !dynamic)) reject(d, 'declarations require an identifier and initializer');
        child(d.id); child(d.init);
      }); break;
    case 'ExpressionStatement':
      if (node.directive === 'use strict') break;
      child(node.expression); break;
    case 'ReturnStatement':
      if (!node.argument && !dynamic) reject(node, 'functions must return a numeric or boolean value');
      child(node.argument); break;
    case 'IfStatement': child(node.test); child(node.consequent); child(node.alternate); break;
    case 'WhileStatement': child(node.test); child(node.body); break;
    case 'ForStatement': child(node.init); child(node.test); child(node.update); child(node.body); break;
    case 'Identifier': break;
    case 'Literal':
      if (node.regex) reject(node, 'regular expression literals are unsupported');
      if (!['number', 'boolean'].includes(typeof node.value) && !(dynamic && (node.value === null || typeof node.value === 'string'))) reject(node, 'only number and boolean literals are supported');
      break;
    case 'MemberExpression':
      if (!dynamic || node.optional) reject(node, 'only fixed properties and computed indexing are supported');
      child(node.object); if (node.computed) child(node.property); break;
    case 'ArrayExpression':
      if (!dynamic) reject(node,'unsupported syntax ArrayExpression');
      if (node.elements.some(x=>!x||x.type==='SpreadElement')) reject(node, 'only dense array literals are supported');
      node.elements.forEach(child); break;
    case 'ObjectExpression':
      if (!dynamic) reject(node,'unsupported syntax ObjectExpression');
      for(const p of node.properties){
        if(p.type!=='Property'||p.method||p.computed||p.kind!=='init'||!((p.key.type==='Identifier')||(p.key.type==='Literal'&&typeof p.key.value==='string')))
          reject(p,'only fixed data properties are supported');
        child(p.value);
      }
      break;
    case 'NewExpression':
      if (!dynamic || node.callee.type!=='Identifier' || node.callee.name!=='Uint8Array' || node.arguments.length!==1)
        reject(node, 'only new Uint8Array(length) is supported');
      child(node.callee); node.arguments.forEach(child); break;
    case 'BinaryExpression':
      if (!binaryOps.has(node.operator)) reject(node, `unsupported operator ${node.operator}`);
      child(node.left); child(node.right); break;
    case 'UnaryExpression':
      if (!unaryOps.has(node.operator)) reject(node, `unsupported unary operator ${node.operator}`);
      child(node.argument); break;
    case 'AssignmentExpression':
      if (!((node.left.type === 'Identifier' && (node.operator === '=' || (node.operator.endsWith('=') && ['+', '-', '*', '/', '&', '|', '^', '<<', '>>', '>>>'].includes(node.operator.slice(0, -1))))) ||
        (dynamic && node.left.type==='MemberExpression' && !node.left.optional && node.operator==='=')))
        reject(node, 'only simple numeric local assignments are supported');
      child(node.left); child(node.right); break;
    case 'UpdateExpression':
      if (node.argument.type !== 'Identifier' || !['++', '--'].includes(node.operator)) reject(node, 'unsupported update');
      child(node.argument); break;
    case 'CallExpression':
      if (node.callee.type === 'MemberExpression') {
        const c = node.callee;
        if (c.computed || c.optional || c.object.type !== 'Identifier' || !((c.object.name === 'console' && c.property.name === 'log') || (c.object.name === 'Math' && c.property.name === 'imul') || (c.object.name === 'Porffor' && ['argumentCount', 'argumentNumber'].includes(c.property.name))))
          reject(node, 'only console.log, Math.imul and the numeric Porffor argument API are supported as member calls');
      } else if (node.callee.type !== 'Identifier' || node.callee.name === 'eval') {
        reject(node, 'only direct function calls are supported');
      }
      node.arguments.forEach(child); break;
    default: reject(node, `unsupported syntax ${node.type}`);
  }
}

class FunctionBuilder {
  constructor(owner, declarations, name, params, dynamic = false) {
    this.owner = owner;
    this.dynamic = dynamic;
    this.declarations = declarations;
    this.nextValue = 0;
    this.blocks = [];
    this.params = params.map(() => S.parameter(this.id(), 'value'));
    this.state = { block: S.block('entry', [], [], null), env: new Map() };
    this.blocks.push(this.state.block);
    params.forEach((p, i) => this.state.env.set(p._variable, this.params[i].id));
    this.name = name;
  }
  id() { return `v${this.nextValue++}`; }
  emit(op, args = [], attributes = {}, type = 'value') {
    const id = type === 'none' ? null : this.id();
    this.state.block.instructions.push(S.instruction(id, op, type, args, attributes));
    return id;
  }
  binding(node) {
    const binding = node._resolvedVariable ?? node._variable;
    if (!binding || !this.state.env.has(binding)) reject(node, 'uninitialized, captured or unsupported binding');
    return binding;
  }
  read(node) { return this.state.env.get(this.binding(node)); }
  writable(node) {
    const b = this.binding(node);
    if (b.kind === 'const') reject(node, 'assignment to const');
    return b;
  }
  expression(node) {
    if (!node && this.dynamic) return this.emit('JsUndefined');
    switch (node.type) {
      case 'Literal':
        if (node.value === null) return this.emit('JsNull');
        if (typeof node.value === 'string') return this.emit('JsString', [], {value: node.value});
        return this.emit(typeof node.value === 'boolean' ? 'JsBoolean' : 'JsNumber', [], { value: node.value });
      case 'Identifier':
        if (this.dynamic && !node._resolvedVariable) {
          if (node.name === 'undefined') return this.emit('JsUndefined');
          if (node.name === 'NaN' || node.name === 'Infinity') return this.emit('JsNumber', [], { value: node.name === 'NaN' ? NaN : Infinity });
        }
        return this.read(node);
      case 'MemberExpression':
        if (node.computed && !(node.property.type==='Literal'&&typeof node.property.value==='string'))
          return this.emit('JsDynamicPropertyGet', [this.expression(node.object),this.expression(node.property)]);
        return this.emit('JsPropertyGet',[this.expression(node.object)],{key:node.computed?node.property.value:node.property.name});
      case 'ArrayExpression': return this.emit('JsArray',node.elements.map(x=>this.expression(x)));
      case 'ObjectExpression': return this.emit('JsObject',node.properties.map(p=>this.expression(p.value)),{keys:node.properties.map(p=>p.key.type==='Identifier'?p.key.name:p.key.value)});
      case 'NewExpression':
        if (node.callee._resolvedVariable) reject(node,'Uint8Array constructor must be unshadowed');
        return this.emit('JsUint8Array',[this.expression(node.arguments[0])]);
      case 'BinaryExpression': {
        const left = this.expression(node.left), right = this.expression(node.right);
        return this.emit(binaryOps.get(node.operator), [left, right]);
      }
      case 'UnaryExpression': return this.emit(unaryOps.get(node.operator), [this.expression(node.argument)]);
      case 'AssignmentExpression': {
        if (node.left.type==='MemberExpression') {
          const object=this.expression(node.left.object);
          if(node.left.computed&&!(node.left.property.type==='Literal'&&typeof node.left.property.value==='string')){
            const key=this.expression(node.left.property),right=this.expression(node.right);return this.emit('JsDynamicPropertySet',[object,key,right]);
          }
          const right=this.expression(node.right),key=node.left.computed?node.left.property.value:node.left.property.name;
          return this.emit('JsPropertySet',[object,right],{key});
        }
        const b = this.writable(node.left), before = this.state.env.get(b);
        const right = this.expression(node.right);
        const value = node.operator === '=' ? right : this.emit(binaryOps.get(node.operator.slice(0, -1)), [before, right]);
        this.state.env.set(b, value); return value;
      }
      case 'UpdateExpression': {
        const b = this.writable(node.argument);
        const before = this.dynamic ? this.emit('JsPositive', [this.state.env.get(b)]) : this.state.env.get(b);
        const one = this.emit('JsNumber', [], { value: 1 });
        const after = this.emit(node.operator === '++' ? 'JsAdd' : 'JsSubtract', [before, one]);
        this.state.env.set(b, after); return node.prefix ? after : before;
      }
      case 'CallExpression': {
        if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'Porffor') {
          if (node.callee.object._resolvedVariable) reject(node, 'argument API requires unshadowed Porffor');
          const count = node.callee.property.name === 'argumentCount';
          if (node.arguments.length !== (count ? 0 : 1)) reject(node, 'argument API arity mismatch');
          return this.emit(count ? 'JsArgumentCount' : 'JsArgumentNumber', node.arguments.map(n => this.expression(n)));
        }
        if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'Math') {
          if (node.callee.object._resolvedVariable) reject(node, 'Math.imul requires unshadowed Math');
          if (node.arguments.length !== 2) reject(node, 'Math.imul requires exactly two values');
          return this.emit('JsImul', node.arguments.map(n => this.expression(n)));
        }
        if (node.callee.type !== 'Identifier') reject(node, 'console.log may only be used as a statement');
        const target = this.declarations.get(node.callee._resolvedVariable);
        if (!target) reject(node, 'call target must be a top-level function binding');
        if (node.arguments.length !== target.node.params.length) reject(node, 'direct call arity mismatch');
        return this.emit('JsDirectCall', node.arguments.map(n => this.expression(n)), { callee: target.name });
      }
      default: reject(node, `unsupported expression ${node.type}`);
    }
  }
  nextState(keys) {
    const params = keys.map(() => S.parameter(this.id(), 'value'));
    const block = S.block(`b${this.blocks.length}`, params, [], null);
    this.blocks.push(block);
    return { block, env: new Map(keys.map((key, i) => [key, params[i].id])) };
  }
  args(state, keys) { return keys.map(k => state.env.get(k)); }
  jump(from, to, keys) { from.block.terminator = S.branch(to.block.id, this.args(from, keys)); }
  scoped(body) {
    const keys = new Set(this.state.env.keys());
    body();
    if (this.state) for (const key of this.state.env.keys()) if (!keys.has(key)) this.state.env.delete(key);
  }
  statement(node) {
    if (!this.state) return; // Syntax was already checked, including unreachable code.
    switch (node.type) {
      case 'EmptyStatement': case 'FunctionDeclaration': break;
      case 'BlockStatement': this.scoped(() => node.body.forEach(n => this.statement(n))); break;
      case 'VariableDeclaration':
        for (const d of node.declarations) this.state.env.set(d.id._variable, this.expression(d.init));
        break;
      case 'ExpressionStatement': {
        if (node.directive === 'use strict') break;
        const e = node.expression;
        if (e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && e.callee.object.name === 'console') {
          if (e.callee.object._resolvedVariable) reject(e, 'console must be the unshadowed host console');
          if (e.arguments.length !== 1) reject(e, 'console.log requires exactly one value');
          this.emit('JsPrint', [this.expression(e.arguments[0])], {}, 'none');
        } else this.expression(e);
        break;
      }
      case 'ReturnStatement':
        this.state.block.terminator = S.returnValue(this.expression(node.argument)); this.state = null; break;
      case 'IfStatement': {
        const condition = this.expression(node.test), from = this.state, keys = [...from.env.keys()];
        const yes = this.nextState(keys), no = this.nextState(keys);
        from.block.terminator = S.conditionalBranch(condition, yes.block.id, this.args(from, keys), no.block.id, this.args(from, keys));
        this.state = yes; this.statement(node.consequent); const yesEnd = this.state;
        this.state = no; if (node.alternate) this.statement(node.alternate); const noEnd = this.state;
        if (!yesEnd && !noEnd) { this.state = null; break; }
        const merge = this.nextState(keys);
        if (yesEnd) this.jump(yesEnd, merge, keys);
        if (noEnd) this.jump(noEnd, merge, keys);
        this.state = merge; break;
      }
      case 'ForStatement': case 'WhileStatement': this.scoped(() => {
        if (node.init) {
          if (node.init.type === 'VariableDeclaration') this.statement(node.init);
          else this.expression(node.init);
        }
        const keys = [...this.state.env.keys()], header = this.nextState(keys);
        this.jump(this.state, header, keys); this.state = header;
        const condition = node.test ? this.expression(node.test) : this.emit('JsBoolean', [], { value: true });
        const body = this.nextState(keys), exit = this.nextState(keys);
        header.block.terminator = S.conditionalBranch(condition, body.block.id, this.args(header, keys), exit.block.id, this.args(header, keys));
        this.state = body; this.statement(node.body);
        if (this.state) {
          if (node.update) this.expression(node.update);
          this.jump(this.state, header, keys);
        }
        this.state = exit;
      }); break;
      default: reject(node, `unsupported statement ${node.type}`);
    }
  }
  finish(body, main = false) {
    body.forEach(n => this.statement(n));
    if (this.state) {
      if (!main && !this.dynamic) reject(this.owner, 'function can fall through without returning a value');
      this.state.block.terminator = S.returnValue(main ? null : this.emit('JsUndefined'));
    }
    return S.func(this.name, this.params, main ? 'none' : 'value', 'entry', this.blocks);
  }
}

export function buildSemantic(source, { dynamic = false } = {}) {
  const ast = parse(source, { ts: false, module: false });
  checkSyntax(ast, false, dynamic);
  const oldHackers = analyzeBindings.objectHackers;
  try { analyzeBindings.objectHackers = []; analyzeBindings(ast); }
  finally { analyzeBindings.objectHackers = oldHackers; }
  const declarations = new Map();
  for (const node of ast.body.filter(n => n.type === 'FunctionDeclaration')) {
    if (declarations.has(node._variable)) reject(node, 'duplicate function binding');
    declarations.set(node._variable, { node, name: `fn${declarations.size}` });
  }
  const functions = [...declarations.values()].map(({ node, name }) =>
    new FunctionBuilder(node, declarations, name, node.params, dynamic).finish(node.body.body));
  functions.push(new FunctionBuilder(ast, declarations, 'main', [], dynamic).finish(ast.body, true));
  return S.validate(S.module('semantic', functions));
}
