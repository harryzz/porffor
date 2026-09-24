# Phase 5 increment 5: ordinary objects and fixed properties

The explicit `--primitives` path supports ordinary object literals, fixed and dynamic string-key property reads, mutation, linked overflow pages, and a small custom-prototype surface. Object values pass through locals, control-flow edges, direct calls, returns, arrays, and other object fields. They are traced by the nonmoving collector.

```sh
node scripts/compile-wasm.mjs --primitives examples/objects/properties.js /tmp/objects.wasm
node scripts/run-numeric-wasm.mjs /tmp/objects.wasm
node scripts/build-component-runtime.mjs
node scripts/compile-component.mjs --primitives examples/objects/properties.js /tmp/objects.component.wasm
node scripts/run-component.mjs /tmp/objects.component.wasm
```

The default numeric mode, command WIT, and host capabilities are unchanged. Allocation, lookup, mutation, and tracing are emitted in core Wasm.

## Source contract

Object literals accept ordinary data properties with identifier or string-literal names, including shorthand properties. Values are evaluated from left to right. Duplicate names keep the last value. Both `value.name` and `value["name"]` compile to fixed property names; `value[key]` and `value[key] = rhs` accept a runtime string key. A missing property returns undefined. Assignment returns its right-hand value and either updates the matching slot or appends a new slot.

`Object.create(proto)` accepts one object or `null`; property reads search the object's own properties, then its prototype chain. Assignments update or append an own property and do not mutate a prototype. `Object.create(null)` ends lookup at that object. Ordinary object literals have no modeled built-in `Object.prototype`; this subset only supports explicitly supplied prototype chains. Every object and overflow page has eight inline slots. Once an object's primary slots fill, assignment allocates linked overflow pages in the same stable heap. Pages are ordinary collector blocks with an internal object tag, so aliases keep the original object's identity as fields are appended. Allocation failure still traps when the arena cannot hold the live objects and pages.

Objects are truthy. Direct object printing, identity equality, object coercion, nonstring dynamic keys, computed property definitions, methods, accessors, spread, deletion, prototype mutation, enumeration, symbols, and property descriptors are rejected. `Object.create` must be the unshadowed built-in. Property keys are stored as traced string values and compared by string contents, so fixed and dynamic access share the same fields. The name `length` receives special read behavior only for strings, arrays, and Uint8Array; an ordinary object's `length` is a normal data property.

The closed-program heap analysis tracks possible values by property name across the module. It is deliberately field-based rather than allocation-sensitive. A known property can be followed through nested fixed reads, while a missing field has no inferred heap type and cannot be used as an object. Programs that reuse one property name for incompatible object and primitive roles can be rejected conservatively.

## Representation and collection

Ordinary objects use packed tag `0x07` with a nonzero low-32-bit payload pointer. The tag is shared with null for compatibility with the retained value layout; null has a zero payload, and every object helper validates that distinction. Each allocation has the collector's eight-byte block header followed by this payload:

| Offset | Contents |
| --- | --- |
| 0 | u32 live property count |
| 4 | u32 inline capacity |
| 8 | packed i64 overflow-page reference, or zero |
| 16 | packed i64 prototype reference (`null` or object) |
| 24 + 16n | packed i64 string property key |
| 32 + 16n | packed i64 jsval property value |

Unused slots are zero-filled and never scanned. Reads scan inline slots and overflow pages at each prototype level, comparing keys by UTF-16 contents. Writes scan only the receiver's own inline slots and overflow pages. Pointer validation checks the tag, nonzero pointer, block status and size, minimum capacity, count/capacity relation, and complete slot span before accessing memory. Overflow pages, prototypes, keys, and values are traced from their owning object.

The mark phase marks an object before recursively visiting its prototype, overflow pages, and every live property key/value. This terminates on cycles and retains nested strings, arrays, typed arrays, and objects. Collection only occurs during allocation, so completed mutations need no write barrier in this single-threaded execution model. Shadow-stack and pooled-string roots retain the earlier collector contract.

## Verification

The core suite covers literals, missing values, fixed and dynamic string keys, multi-page mutation, explicit prototype chains, own-property shadowing, null prototypes, prototype retention through collection, shorthand and duplicate names, calls, truthiness, ordinary `length`, nested fields, evaluation order, cycles, and rejected boundaries. Twelve fixtures compare object behavior across Node, the retained C backend, the lowered interpreter, and emitted Wasm. Fourteen component tests run that surface through Wasmtime and preserve the command WIT snapshot. The core growth case writes and reads 25 properties across multiple pages. All three object test suites pass; see the Phase 5 work log for results.

See [the Phase 5 work log](phase-5-work-log.md) for complete baseline results. Prototype mutation, built-in prototypes, closures, indirect calls, exceptions, and additional built-ins remain separate migrations.
