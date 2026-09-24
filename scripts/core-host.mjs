// Development host capabilities. Box dispatch, allocation and string semantics
// remain in emitted Wasm. Host owns a disjoint memory arena, formatting and I/O.
import { numericArguments } from './numeric-arguments.mjs';
import { STRING_HEAP_BYTES } from '../compiler/runtime-v2/value-layout.mjs';
export function coreHost(args=[], print=console.log) {
  const base=8;
  let memory;
  const getMemory=()=>memory??=new WebAssembly.Memory({initial:Math.ceil((base+STRING_HEAP_BYTES)/65536)});
  const range=(pointer,length)=>{
    pointer>>>=0;length>>>=0;
    if(pointer<base || pointer%2 || length>(STRING_HEAP_BYTES/2) || pointer+length*2>base+STRING_HEAP_BYTES)
      throw new WebAssembly.RuntimeError('String host access outside arena');
    return new Uint16Array(getMemory().buffer,pointer,length);
  };
  return {
    ...numericArguments(args), get memory(){return getMemory();}, string_heap_base:()=>{getMemory();return base;},
    print_number:x=>print(x), print_boolean:x=>print(x!==0), print_null:()=>print(null), print_undefined:()=>print(undefined),
    print_string:(pointer,length)=>{
      const units=range(pointer,length), chunks=[];
      for(let i=0;i<units.length;i+=8192)chunks.push(String.fromCharCode(...units.subarray(i,i+8192)));
      print(chunks.join(''));
    },
    format_number:(number,pointer)=>{
      const text=String(number),units=range(pointer,64);
      if(text.length>64)throw new WebAssembly.RuntimeError('Number formatter exceeded capacity');
      for(let i=0;i<text.length;i++)units[i]=text.charCodeAt(i);
      return text.length;
    }
  };
}
