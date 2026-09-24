export const integerCases = [
  { name: 'bitwise', source: 'console.log(6&3);console.log(6|3);console.log(6^3);console.log(~0);', expected: [2,7,5,-1] },
  { name: 'signed-unsigned', source: 'console.log(4294967295|0);console.log(-1>>>0);console.log(2147483648>>0);console.log(2147483648>>>0);', expected: [-1,4294967295,-2147483648,2147483648] },
  { name: 'integer-conversions', source: 'console.log(4294967297.75|0);console.log(-4294967297.75|0);console.log(3.9|0);console.log(-3.9|0);console.log(-0|0);', expected: [1,-1,3,-3,0] },
  { name: 'nonfinite-integers', source: 'console.log((0/0)|0);console.log((1/0)>>>0);console.log((-1/0)|0);console.log((1e100)|0);', expected: [0,0,0,0] },
  { name: 'masked-shifts', source: 'console.log(1<<32);console.log(1<<33);console.log(1<<-1);console.log(-8>>1);console.log(-8>>>1);console.log(4>>33.9);', expected: [1,2,-2147483648,-4,2147483644,2] },
  { name: 'imul-wrap', source: 'console.log(Math.imul(2147483647,2));console.log(Math.imul(4294967295,4294967295));console.log(Math.imul(-3.9,5));console.log(Math.imul(0/0,4));', expected: [-2,1,-15,0] },
  { name: 'multiply-is-not-imul', source: 'console.log((4294967295*4294967295)|0);console.log(Math.imul(4294967295,4294967295));console.log(2147483647+1);', expected: [0,1,2147483648] },
  { name: 'integer-assignments', source: 'let x=7;x&=3;x|=8;x^=1;console.log(x);x<<=2;x>>=1;console.log(x);x>>>=1;console.log(x);', expected: [10,20,10] },
  { name: 'integer-calls-loops', source: 'function mix(x){return Math.imul(x,3)^5;}let x=1;for(let i=0;i<4;i++)x=mix(x);console.log(x);console.log((x>>>0)+0.5);', expected: [197,197.5] },
  { name: 'integer-results-are-numbers', source: 'console.log((3&1)===true);console.log((3&1)===1);console.log(!(0|0));', expected: [false,true,true] }
];
