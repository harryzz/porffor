// Porffor scalar packed-value ABI (compiler/render.js: porf_pack/porf_unpack).
// Heap-bearing types are reserved, never accepted by the primitive helpers yet.
export const VALUE_PATTERN = 0xfff8000000000000n;
export const VALUE_UNDEFINED = VALUE_PATTERN;
export const VALUE_FALSE = VALUE_PATTERN | (2n << 43n);
export const VALUE_TRUE = VALUE_FALSE | 1n;
export const VALUE_NULL = VALUE_PATTERN | (7n << 43n); // object type, null payload
export const VALUE_OBJECT = VALUE_NULL; // nonzero payload distinguishes ordinary objects
export const CANONICAL_NAN = 0x7ff8000000000000n;
export const VALUE_STRING = VALUE_PATTERN | (0x43n << 43n);
export const VALUE_ARRAY = VALUE_PATTERN | (0x48n << 43n);
export const VALUE_UINT8ARRAY = VALUE_PATTERN | (0x51n << 43n);
export const VALUE_FUNCTION = VALUE_PATTERN | (0x5an << 43n);
export const STRING_HEAP_BYTES = 4 * 1024 * 1024;
