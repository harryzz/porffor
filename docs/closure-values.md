# Phase 5 increment 9: closures and indirect calls

The `--primitives` path supports synchronous arrow closures stored in locals, returned from functions, and invoked through a function-valued local. Each closure has a distinct environment object and can capture lexically visible `const` values. Calls pass an argument array through one uniform closure ABI; the backend selects the matching compiled closure target with a checked dispatch and direct Wasm calls.

```js
function makeAdder() {
  const base = 40;
  return amount => amount + base;
}

const add = makeAdder();
console.log(add(2));
```

The source exclusions are deliberate: captures must be `const`; mutable captures, function declarations or expressions as values, `this`, `arguments`, constructors, async/generator closures, direct closure printing/equality, and arbitrary callable objects are unsupported. Wrong-arity closure calls follow ordinary argument-array behavior for this subset: missing parameters read as undefined, and extra arguments are ignored.

Closures use the packed function tag `0x5a` with a nonzero heap pointer. The 24-byte heap block contains an eight-byte collector header, a u32 closure-target index at payload offset 0, a reserved u32 at offset 4, and a packed jsval environment reference at offset 8. The collector marks the closure before recursively marking the environment object. The environment stores captured values under compiler-generated string keys and is allocated through the ordinary object helpers.

Each compiled arrow has the same Wasm signature: `(environment jsval, argument-array jsval) -> jsval`. `ClosureCreate` stores the finite target index and environment; indirect invocation reads both and emits a target dispatch. This avoids Wasm table/element sections that the current WASI command adapter cannot package, while preserving selection from a runtime closure value. An invalid target traps.

The lowered interpreter, core Wasm tests, Node/C/Wasm differential tests, and Wasmtime component tests cover captures, distinct environments, block and expression bodies, returned closures, and GC retention. See the [Phase 5 work log](phase-5-work-log.md) for current results.
