export const types = { i32: 0x7f, u32: 0x7f, i64: 0x7e, u64: 0x7e, f64: 0x7c, jsval: 0x7e };
export const uleb = value => {
  let n = BigInt(value), out = [];
  do { const b = Number(n & 127n); n >>= 7n; out.push(b | (n ? 128 : 0)); } while (n);
  return out;
};
export const sleb = value => {
  let n = BigInt(value), out = [];
  while (true) {
    const b = Number(n & 127n); n >>= 7n;
    const done = (n === 0n && !(b & 64)) || (n === -1n && (b & 64));
    out.push(b | (done ? 0 : 128));
    if (done) return out;
  }
};
export const vector = entries => [...uleb(entries.length), ...entries.flat()];
export const string = s => { const bytes = [...new TextEncoder().encode(s)]; return [...uleb(bytes.length), ...bytes]; };
export const section = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
export const get = i => [0x20, ...uleb(i)];
export const set = i => [0x21, ...uleb(i)];
export const i32 = n => [0x41, ...sleb(BigInt.asIntN(32, BigInt(n)))];
export const i64 = n => [0x42, ...sleb(BigInt.asIntN(64, BigInt(n)))];
export const f64 = n => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, n, true);
  return [0x44, ...bytes];
};
export const body = (locals, code) => {
  const bytes = [...vector(locals.map(t => [1, types[t]])), ...code, 0x0b];
  return [...uleb(bytes.length), ...bytes];
};
