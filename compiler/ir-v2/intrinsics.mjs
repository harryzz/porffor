// Fixed capabilities only. No arbitrary host symbol, ABI string or embedded source.
// Consumers must preserve instruction order; these capabilities are effectful.
export const printIntrinsics = Object.freeze({
  PrintNumber: Object.freeze({ args: Object.freeze(['f64']), result: 'none', effects: Object.freeze(['host-write']) }),
  PrintBoolean: Object.freeze({ args: Object.freeze(['i32']), result: 'none', effects: Object.freeze(['host-write']) })
});

export const argumentIntrinsics = Object.freeze({
  ArgumentCount: Object.freeze({ args: Object.freeze([]), result: 'f64', effects: Object.freeze(['host-read']) }),
  ArgumentNumber: Object.freeze({ args: Object.freeze(['f64']), result: 'f64', effects: Object.freeze(['host-read']) })
});
