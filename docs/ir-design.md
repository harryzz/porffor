# Semantic and lowered IR design

Status: isolated Phase 2 numeric IR and Phase 3 core-Wasm implementation; see [the supported subset](numeric-subset.md) and [step-by-step work log](phase-2-work-log.md). Production remains `parse.js -> semantic.js/codegen.js -> ir.js -> render.js -> C`. The files under `compiler/ir-v2/` are not imported by that pipeline or the selfhost bundle. They now provide a separate numeric frontend, construction, validation and semantic lowering. `emitCoreWasm` now directly emits the numeric core-Wasm subset; see [the backend contract](core-wasm.md) and [Phase 3 work log](phase-3-work-log.md). A separate [Phase 4 packager](wasip3-command.md) now wraps the numeric core module as a WASI 0.3 command component.

## Layers and ownership

1. **Semantic IR** represents JavaScript operations before representation selection. `JsAdd(a, b)` retains string concatenation, coercion and observable evaluation order. It is never defined as a C expression or a particular runtime call. The semantic `value` type means any JavaScript value; it is not NaN boxing. A function is a CFG with semantic instructions and explicit terminators. `ConditionalBranch` applies JavaScript truthiness to its `value` condition.
2. **Lowered IR** represents typed computation after semantic lowering and representation selection. Types are `none`, `i32`, `u32`, `i64`, `u64`, `f64`, `jsval`, `linear-ptr`. `none` is only a function/instruction result, never a value or parameter. `jsval` now has a [boxed primitive implementation](primitive-values.md) in an explicit separate lowering mode. The numeric path remains specialized; `linear-ptr` still cannot be manufactured, inspected or dereferenced. `gc-ref` is reserved in the design and deliberately rejected until a representation exists. No C syntax, C type spelling, arbitrary operator field, implicit host call, Rust assumptions or component encoding is allowed.
3. **Core-Wasm backend** selects instructions, assigns indices and encodes CFGs using a dispatcher loop, including irreducible graphs; representation decisions belong upstream. No source-language intermediate is permitted.
4. **Component packaging** wraps emitted core Wasm with WIT/canonical ABI metadata and use standard component tools initially. WIT describes public boundaries, not JS internal values or IR types.

Core WebAssembly defines execution instructions, memories and tables. WasmGC adds managed core-Wasm references and is an optional later representation. The Component Model adds typed component boundaries. WASI 0.3 adds interfaces using component-native concurrency, including futures and streams. These are separate technologies. The current experimental pipeline implements numeric core Wasm and a limited WASI 0.3 command wrapper, without JS async or WasmGC support.

## Implemented schema

Constructors are plain object builders; `validate` is the required boundary and accepts or throws `TypeError`. Unknown fields are rejected rather than treated as extensions. Builders do not freeze nodes; callers must validate after mutation and before consuming them. No validator mutates or normalizes its input.

| Node | Exact fields |
| --- | --- |
| Module | `layer`, `functions` |
| Function | `name`, `params`, `result`, `entry`, `blocks` |
| Parameter | `id`, `type` |
| Basic block | `id`, `params`, `instructions`, `terminator` |
| Instruction | `id`, `op`, `type`, `args`; constants add `value`, direct calls add `callee` |
| Return | `op: 'Return'`, `value` (identifier or null for void) |
| Branch | `op: 'Branch'`, `target`, `args` |
| Conditional branch | `op: 'ConditionalBranch'`, `condition`, `thenTarget`, `thenArgs`, `elseTarget`, `elseArgs` |

Identifiers use `[A-Za-z_][A-Za-z0-9_]*`; they are symbolic IDs, not backend source expressions. Blocks and functions have separate namespaces. Value IDs are unique throughout one function, including its parameters and every block parameter/result.

The semantic operation set includes numeric/boolean constants, `JsAdd`, `JsSubtract`, `JsMultiply`, `JsDivide`, ordered and strict comparisons, `JsNegate`, `JsPositive`, `JsNot`, `JsDirectCall`, closure creation/capture/invocation, and `JsPrint`. Integer increment operations include `JsBitAnd`, `JsBitOr`, `JsBitXor`, `JsBitNot`, `JsShiftLeft`, `JsShiftRight`, `JsUnsignedShiftRight`, and `JsImul`. The dynamic path also has explicit string, array, Uint8Array, ordinary-object, indexed-access, fixed-property, and prototype operations. All produce `value`, except printing or a declared void direct call. `JsDirectCall` is only for statically resolved functions with no dynamic this/newTarget convention. The closure subset and its finite target dispatch are documented separately; general function objects, mutable captures and exceptions remain unsupported.

The lowered operation set has `I32/U32/I64/U64/F64` prefixes for `Const`, `Add`, `Subtract`, `Multiply`, `Equal`, `LessThan`, plus `DirectCall`. Phase 4 adds `JsArgumentCount`/`JsArgumentNumber`, lowered to fixed numeric `ArgumentCount`/`ArgumentNumber` host-read intrinsics; their contract is in the command documentation. The numeric lowering adds f64 division, ordered comparisons, negation, identity and truthiness, and fixed void `PrintNumber`/`PrintBoolean` intrinsics with host-write effects. Arithmetic wraps at the declared integer width; unsigned comparisons differ from signed comparisons. Floating operations use IEEE binary64; equality and ordered comparisons produce false for NaN, while inequality produces true for unordered operands; all comparison results are i32 0 or 1. Signed zero and NaN are accepted f64 literals. i64/u64 literals use JavaScript BigInt and are range checked; serialization is not yet defined. i32/u32 literals are integral Numbers within their exact range. A lowered condition is i32 (zero false, nonzero true).

## CFG invariants

- Every function has an existing entry block with no block parameters. Function arguments bind function parameters, which are available in all blocks.
- Every block has exactly one separate terminator, and terminators cannot appear in its instruction list.
- Only previously defined values in the same block, its block parameters and function parameters may be used. Cross-block values must be passed through block arguments. This conservative SSA form avoids an implicit dominance assumption; a future relaxation requires a dominance validator.
- All edge targets exist in the same function. Entry cannot be a branch target; use a separate loop header. Each edge supplies precisely the target parameter types and arity. Edge assignments occur simultaneously.
- All blocks must be reachable from entry. Self-loops and mutually reachable loops are valid; termination is not required. Source unreachable-code removal precedes this validation.
- Every operation has a declared signature and exact operand/result types. Call names resolve within the module, including recursive calls. There are no implicit imports.
- Every nonvoid instruction defines a unique ID. A void call has `id: null`. Returns match the enclosing function's declared result.

Example using the constructors exported by `lowered.mjs`:

```js
const m = module('lowered', [
  func('add', [parameter('a', 'i32'), parameter('b', 'i32')], 'i32', 'entry', [
    block('entry', [], [instruction('sum', 'I32Add', 'i32', ['a', 'b'])],
      returnValue('sum'))
  ])
]);
validate(m);
```

Tests include malformed nodes, unknown fields and ops, wrong layers/types, duplicate IDs, forward/nonlocal uses, missing terminators, invalid edges, unreachable blocks, branch argument arity/types, loop-carried values, void and typed calls, and integer literal boundaries. Run `node tests/ir-v2.test.mjs` or `node --test tests/ir-v2.test.mjs`.

## Implemented slice and remaining Phase 2 work

The numeric adapter reuses parsing and binding analysis, builds semantic operations in evaluation order, lowers locals to block parameters, and converts if/loops to edges. The numeric mode uses a separate constraint pass to determine number/boolean representation; Phase 5 primitive mode instead selects boxed jsval for semantic values and supports mixed primitive flows. Closure support and full IR source-span metadata remain unimplemented. Numeric mode selects `F64Add` only for proven numbers. Primitive mode converts non-string primitives for numeric arithmetic and uses `ValueAdd` in string-bearing modules to preserve numeric addition or string concatenation. Object coercion and exceptions remain unsupported. Typed i32 specialization requires an explicit language policy, not silent truncation of ordinary JS numbers.

Printing has a fixed typed host-write signature; calls may transitively print. Instruction order is preserved and there is no optimizer. Before adding further effects or optimization, introduce checked memory/allocation/throw/suspend contracts and an exceptional-control-flow policy. Object/property ops remain abstract until representation selection. Planned memory operations carry access width, signedness, alignment and offset, never C strings. Planned imports/runtime intrinsics have declared argument/result types and effects, distinct from internal `DirectCall`; no user-selected arbitrary native symbol.

Initially preserve NaN-boxed 64-bit values and linear-memory objects with a tracing collector. GC roots need explicit safepoints and root maps; native stack/register scanning will not work in Wasm. Exception lowering is proposed as explicit completion results and propagation edges before considering Wasm EH. Suspend/resume requires a coroutine state machine and GC-visible frames. JS promises stay JS objects; future conversion occurs only at WIT boundaries with explicit rejection, cancellation and cleanup policies. A host-neutral scheduler drains JS jobs and yields to component tasks. No blocking native polling loop is carried forward.

The first lowering implementation must add either a C consumer of the new subset or differential tests against the retained production C path. The numeric slice now has mandatory differential tests against Node and the retained C path through a test-only lowered-IR interpreter. One existing C evaluation-order regression is named and asserted separately; it is not reported as equivalent. The baseline tests also protect the unchanged compiler. Only after those equivalence tests and validators pass should a direct numeric Wasm backend be introduced.

## Integer increment

The [integer semantics contract](phase-2-integer-semantics.md) defines modulo float-to-i32/u32 conversions, integer bit operations, shifts, and wrapping multiplication. Results return to f64 at JavaScript Number boundaries. These conversions are not raw C casts or trapping/saturating conversions; backends must implement their documented semantics.

## Phase 5 primitive representation

[Primitive values](primitive-values.md) defines the executable jsval encoding and checked helper signatures. [String values](string-values.md) adds UTF-16 strings, explicit shadow-stack roots and a nonmoving mark-sweep collector. [Arrays and Uint8Array](array-values.md) add indexed operations and type-directed tracing of packed child values. [Ordinary objects](object-values.md) add dynamic string-key fields, linked overflow pages, explicit prototype chains, inline mutation, and recursive property tracing. [The Phase 5 work log](phase-5-work-log.md) records the increments. Closures and other allocated layouts remain unimplemented.
