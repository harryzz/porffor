// Nonmoving mark-sweep storage for UTF-16 strings and heap containers. Emitted
// functions keep jsval locals in an explicit shadow stack; pooled literals are
// global roots, and aggregate marking recursively traces packed child values.
import {body,get,set,i32,i64,f64,uleb} from './encoding.mjs';
import {primitiveHelpers} from './primitives.mjs';
import {VALUE_STRING,VALUE_ARRAY,VALUE_UINT8ARRAY,VALUE_OBJECT,VALUE_NULL,VALUE_UNDEFINED,VALUE_FALSE,VALUE_TRUE,STRING_HEAP_BYTES} from '../../runtime-v2/value-layout.mjs';
const gg=i=>[0x23,...uleb(i)],gs=i=>[0x24,...uleb(i)];
const isString=i=>[...get(i),...i64(0xffffffff00000000n),0x83,...i64(VALUE_STRING),0x51];
const isTag=(i,value)=>[...get(i),...i64(0xffffffff00000000n),0x83,...i64(value),0x51];
const eq=(i,v)=>[...get(i),...i64(v),0x51];
const fail=c=>[...c,0x04,0x40,0x00,0x0b],ret=(c,v)=>[...c,0x04,0x40,...v,0x0f,0x0b];
const load=[0x28,2,0],store=[0x36,2,0],load64=[0x29,3,0],store64=[0x37,3,0];
const loadAt=o=>[0x28,2,...uleb(o)],storeAt=o=>[0x36,2,...uleb(o)],store64At=o=>[0x37,3,...uleb(o)];
const tag=p=>[...p,0xad,...i64(VALUE_STRING),0x84];
const tagFor=(value,p)=>[...p,0xad,...i64(value),0x84];

export function stringHelpers(texts,{heapBytes=STRING_HEAP_BYTES}={}) {
  const rootBytes=Math.min(65536,Math.max(64,Math.floor(heapBytes/64)*8));
  if(heapBytes<256||rootBytes+32>heapBytes)throw new RangeError('String heap is too small for roots and objects');
  const literals=new Map([...new Set([...texts,'true','false','null','undefined','length'])].map((s,i)=>[s,{name:`StringLiteral${i}`,global:i+4}]));
  const literal=s=>literals.get(s).name,r={...primitiveHelpers};
  // Globals: base, object cursor, shadow-stack top, collection count, literals.
  r.HeapInit={params:[],result:'none',emit:call=>body(['i32'],[
    ...gg(0),0x45,0x04,0x40,...call('HeapBase'),...set(0),...fail([...get(0),0x45]),...fail([...get(0),...i32(7),0x71]),
    ...fail([...get(0),0xad,...i64(heapBytes),0x7c,0x3f,0,0xad,...i64(65536),0x7e,0x56]),
    ...i32(rootBytes),...gs(1),...i32(0),...gs(2),...get(0),...gs(0),0x0b
  ])};
  r.RootEnter={params:['i32'],result:'i32',dependencies:['HeapInit'],emit:call=>body(['i32','i32'],[
    ...call('HeapInit'),...fail([...get(0),...i32(rootBytes/8),0x4b]),...gg(2),...set(1),
    ...fail([...get(0),...i32(8),0x6c,...i32(rootBytes),...get(1),0x6b,0x4b]),...get(1),...get(0),...i32(8),0x6c,0x6a,...gs(2),
    0x02,0x40,0x03,0x40,...get(2),...get(0),0x4f,0x0d,1,...gg(0),...get(1),0x6a,...get(2),...i32(8),0x6c,0x6a,...i64(VALUE_UNDEFINED),...store64,
    ...get(2),...i32(1),0x6a,...set(2),0x0c,0,0x0b,0x0b,...get(1)
  ])};
  r.RootSet={params:['i32','i32','jsval'],result:'none',dependencies:['HeapInit'],emit:call=>body([], [
    ...fail([...get(0),...get(1),...i32(8),0x6c,0x6a,...i32(8),0x6a,...gg(2),0x4b]),
    ...gg(0),...get(0),0x6a,...get(1),...i32(8),0x6c,0x6a,...get(2),...store64
  ])};
  r.RootLeave={params:['i32','i32'],result:'none',dependencies:['HeapInit'],emit:call=>body([], [
    ...fail([...get(0),...get(1),...i32(8),0x6c,0x6a,...gg(2),0x47]),...get(0),...gs(2)
  ])};
  r.RootPush={params:['jsval'],result:'none',dependencies:['RootEnter','RootSet'],emit:call=>body(['i32'],[
    ...i32(1),...call('RootEnter'),...set(1),...get(1),...i32(0),...get(0),...call('RootSet')
  ])};
  r.RootPop={params:[],result:'none',dependencies:['RootLeave'],emit:call=>body([], [
    ...fail([...gg(2),...i32(8),0x49]),...gg(2),...i32(8),0x6b,...i32(1),...call('RootLeave')
  ])};
  r.StringPointer={params:['jsval'],result:'i32',dependencies:['HeapInit'],emit:call=>body(['i32','i32','i32'],[
    ...call('HeapInit'),...fail([...isString(0),0x45]),...get(0),0xa7,...set(1),
    ...fail([...get(1),...gg(0),...i32(rootBytes+8),0x6a,0x49]),...fail([...get(1),...gg(0),0x6b,...i32(7),0x71]),
    ...fail([...get(1),...gg(0),0x6b,...gg(1),...i32(8),0x6b,0x4b]),...get(1),...i32(4),0x6b,...load,...set(2),
    ...fail([...get(2),0x45]),...fail([...get(2),...i32(3),0x4b]),...get(1),...i32(8),0x6b,...load,...set(3),
    ...fail([...get(3),...i32(16),0x49]),...fail([...get(3),...i32(7),0x71]),
    ...fail([...get(1),...gg(0),0x6b,...i32(8),0x6b,...get(3),0x6a,...gg(1),0x4b]),...get(1),...load,...set(2),
    ...fail([...get(2),...get(3),...i32(12),0x6b,...i32(1),0x76,0x4b]),...get(1)
  ])};
  const pointerHelper=(tagValue,elementBytes,headerBytes)=>({params:['jsval'],result:'i32',dependencies:['HeapInit'],emit:call=>body(['i32','i32','i32'],[
    ...call('HeapInit'),...fail([...isTag(0,tagValue),0x45]),...get(0),0xa7,...set(1),
    ...fail([...get(1),...gg(0),...i32(rootBytes+8),0x6a,0x49]),...fail([...get(1),...gg(0),0x6b,...i32(7),0x71]),
    ...fail([...get(1),...gg(0),0x6b,...gg(1),...i32(8),0x6b,0x4b]),...get(1),...i32(4),0x6b,...load,...set(2),
    ...fail([...get(2),0x45]),...fail([...get(2),...i32(3),0x4b]),...get(1),...i32(8),0x6b,...load,...set(3),
    ...fail([...get(3),...i32(16),0x49]),...fail([...get(3),...i32(7),0x71]),
    ...fail([...get(1),...gg(0),0x6b,...i32(8),0x6b,...get(3),0x6a,...gg(1),0x4b]),...get(1),...load,...set(2),
    ...fail([...get(2),...get(3),...i32(8+headerBytes),0x6b,...i32(elementBytes===8?3:0),0x76,0x4b]),...get(1)
  ])});
  r.ArrayPointer=pointerHelper(VALUE_ARRAY,8,8);
  r.Uint8ArrayPointer=pointerHelper(VALUE_UINT8ARRAY,1,4);
  r.ObjectPointer={params:['jsval'],result:'i32',dependencies:['HeapInit'],emit:call=>body(['i32','i32','i32','i32'],[
    ...call('HeapInit'),...fail([...isTag(0,VALUE_OBJECT),0x45]),...get(0),0xa7,...set(1),...fail([...get(1),0x45]),
    ...fail([...get(1),...gg(0),...i32(rootBytes+8),0x6a,0x49]),...fail([...get(1),...gg(0),0x6b,...i32(7),0x71]),
    ...fail([...get(1),...gg(0),0x6b,...gg(1),...i32(8),0x6b,0x4b]),...get(1),...i32(4),0x6b,...load,...set(2),
    ...fail([...get(2),0x45]),...fail([...get(2),...i32(3),0x4b]),...get(1),...i32(8),0x6b,...load,...set(2),
    ...fail([...get(2),...i32(152),0x49]),...fail([...get(2),...i32(7),0x71]),
    ...fail([...get(1),...gg(0),0x6b,...i32(8),0x6b,...get(2),0x6a,...gg(1),0x4b]),
    ...get(1),...load,...set(3),...get(1),...loadAt(4),...set(4),
    ...fail([...get(4),...i32(8),0x49]),...fail([...get(3),...get(4),0x4b]),
    ...fail([...get(4),...get(2),...i32(24),0x6b,...i32(4),0x76,0x4b]),...get(1)
  ])};
  r.MarkValue={params:['jsval'],result:'none',dependencies:['StringPointer','ArrayPointer','Uint8ArrayPointer','ObjectPointer'],emit:call=>body(['i32','i32','i32'],[
    ...isString(0),0x04,0x40,...get(0),...call('StringPointer'),...set(1),...get(1),...i32(4),0x6b,...i32(3),...store,0x0f,0x0b,
    ...isTag(0,VALUE_UINT8ARRAY),0x04,0x40,...get(0),...call('Uint8ArrayPointer'),...set(1),...get(1),...i32(4),0x6b,...i32(3),...store,0x0f,0x0b,
    ...isTag(0,VALUE_ARRAY),0x04,0x40,...get(0),...call('ArrayPointer'),...set(1),
      ...get(1),...i32(4),0x6b,...load,...i32(3),0x46,0x04,0x40,0x0f,0x0b,
      ...get(1),...i32(4),0x6b,...i32(3),...store,...get(1),...load,...set(2),
      0x02,0x40,0x03,0x40,...get(3),...get(2),0x4f,0x0d,1,
        ...get(1),...i32(8),0x6a,...get(3),...i32(8),0x6c,0x6a,...load64,...call('MarkValue'),
        ...get(3),...i32(1),0x6a,...set(3),0x0c,0,0x0b,0x0b,
    0x0b,
    ...isTag(0,VALUE_OBJECT),...get(0),0xa7,0x45,0x45,0x71,0x04,0x40,...get(0),...call('ObjectPointer'),...set(1),
      ...get(1),...i32(4),0x6b,...load,...i32(3),0x46,0x04,0x40,0x0f,0x0b,
      ...get(1),...i32(4),0x6b,...i32(3),...store,...get(1),...load,...set(2),...i32(0),...set(3),
      0x02,0x40,0x03,0x40,...get(3),...get(2),0x4f,0x0d,1,
        ...get(1),...i32(16),0x6a,...get(3),...i32(16),0x6c,0x6a,...load64,...call('MarkValue'),
        ...get(1),...i32(24),0x6a,...get(3),...i32(16),0x6c,0x6a,...load64,...call('MarkValue'),
        ...get(3),...i32(1),0x6a,...set(3),0x0c,0,0x0b,0x0b,
      ...get(1),...i32(8),0x6a,...load64,...call('MarkValue'),
    0x0b
  ])};
  r.Sweep={params:[],result:'none',dependencies:['HeapInit'],emit:call=>body(['i32','i32','i32','i32'],[
    ...i32(rootBytes),...set(0),0x02,0x40,0x03,0x40,...get(0),...gg(1),0x4f,0x0d,1,
    ...gg(0),...get(0),0x6a,...load,...set(1),...fail([...get(1),...i32(16),0x49]),...fail([...get(1),...i32(7),0x71]),
    ...fail([...get(0),...get(1),0x6a,...gg(1),0x4b]),...gg(0),...get(0),0x6a,...loadAt(4),...set(2),...fail([...get(2),...i32(3),0x4b]),
    ...get(2),...i32(3),0x46,0x04,0x40,...gg(0),...get(0),0x6a,...i32(1),...storeAt(4),
    0x05,...get(2),...i32(1),0x46,0x04,0x40,...gg(0),...get(0),0x6a,...i32(0),...storeAt(4),0x0b,0x0b,
    ...get(0),...get(1),0x6a,...set(0),0x0c,0,0x0b,0x0b,
    // Second pass coalesces adjacent free blocks.
    ...i32(rootBytes),...set(0),0x02,0x40,0x03,0x40,...get(0),...gg(1),0x4f,0x0d,1,
    ...gg(0),...get(0),0x6a,...load,...set(1),...gg(0),...get(0),0x6a,...loadAt(4),0x45,0x04,0x40,
    ...get(0),...get(1),0x6a,...set(3),0x02,0x40,0x03,0x40,...get(3),...gg(1),0x4f,0x0d,1,
    ...gg(0),...get(3),0x6a,...loadAt(4),0x45,0x45,0x0d,1,...gg(0),...get(3),0x6a,...load,...set(2),
    ...fail([...get(2),...i32(16),0x49]),...fail([...get(2),...i32(7),0x71]),...get(1),...get(2),0x6a,...set(1),...get(3),...get(2),0x6a,...set(3),0x0c,0,0x0b,0x0b,
    ...gg(0),...get(0),0x6a,...get(1),...store,0x0b,...get(0),...get(1),0x6a,...set(0),0x0c,0,0x0b,0x0b
  ])};
  r.Collect={params:[],result:'none',dependencies:['MarkValue','Sweep'],emit:call=>{
    const c=[...i32(0),...set(0),0x02,0x40,0x03,0x40,...get(0),...gg(2),0x4f,0x0d,1,...gg(0),...get(0),0x6a,...load64,...call('MarkValue'),...get(0),...i32(8),0x6a,...set(0),0x0c,0,0x0b,0x0b];
    for(const {global} of literals.values())c.push(...gg(global),0x04,0x40,...tag(gg(global)),...call('MarkValue'),0x0b);
    c.push(...call('Sweep'),...gg(3),...i32(1),0x6a,...gs(3));return body(['i32'],c);
  }};
  r.RawAlloc={params:['i32'],result:'i32',dependencies:['HeapInit'],emit:call=>body(['i32','i32','i32'],[
    ...i32(rootBytes),...set(1),0x02,0x40,0x03,0x40,...get(1),...gg(1),0x4f,0x0d,1,...gg(0),...get(1),0x6a,...load,...set(2),
    ...fail([...get(2),...i32(16),0x49]),...fail([...get(2),...i32(7),0x71]),...gg(0),...get(1),0x6a,...loadAt(4),0x45,...get(2),...get(0),0x4f,0x71,0x04,0x40,
    ...get(2),...get(0),0x6b,...i32(16),0x4f,0x04,0x40,
      ...get(2),...get(0),0x6b,...set(3),...gg(0),...get(1),0x6a,...get(0),...store,
      ...gg(0),...get(1),0x6a,...get(0),0x6a,...get(3),...store,
      ...gg(0),...get(1),0x6a,...get(0),0x6a,...i32(0),...storeAt(4),
    0x0b,
    ...gg(0),...get(1),0x6a,...i32(1),...storeAt(4),...gg(0),...get(1),0x6a,...i32(8),0x6a,0x0f,0x0b,
    ...get(1),...get(2),0x6a,...set(1),0x0c,0,0x0b,0x0b,
    ...get(0),...i32(heapBytes),...gg(1),0x6b,0x4b,0x04,0x7f,...i32(0),0x05,...gg(0),...gg(1),0x6a,...set(1),
    ...get(1),...get(0),...store,...get(1),...i32(1),...storeAt(4),...gg(1),...get(0),0x6a,...gs(1),...get(1),...i32(8),0x6a,0x0b
  ])};
  r.HeapAlloc={params:['i32'],result:'i32',dependencies:['RawAlloc','Collect'],emit:call=>body(['i32'],[
    ...get(0),...call('RawAlloc'),...set(1),...get(1),0x45,0x04,0x40,...call('Collect'),...get(0),...call('RawAlloc'),...set(1),0x0b,
    ...fail([...get(1),0x45]),...get(1)
  ])};
  r.StringAlloc={params:['i32'],result:'i32',dependencies:['HeapAlloc'],emit:call=>body(['i32'],[
    ...fail([...get(0),...i32((heapBytes-rootBytes-16)/2),0x4b]),...get(0),...i32(2),0x6c,...i32(19),0x6a,...i32(-8),0x71,...call('HeapAlloc'),...set(1),
    ...get(1),...get(0),...store,...get(1)
  ])};
  const maxArrayLength=Math.floor((heapBytes-rootBytes-16)/8);
  r.ArrayCreate={params:['f64'],result:'jsval',dependencies:['HeapAlloc'],emit:call=>body(['i32','i32','i32'],[
    ...fail([...get(0),...f64(0),0x63]),...fail([...get(0),...f64(maxArrayLength),0x64]),
    ...get(0),0xfc,3,...set(1),...fail([...get(1),0xb8,...get(0),0x62]),
    ...get(1),...i32(8),0x6c,...i32(16),0x6a,...call('HeapAlloc'),...set(2),
    ...get(2),...get(1),...store,...get(2),...i32(0),...storeAt(4),
    0x02,0x40,0x03,0x40,...get(3),...get(1),0x4f,0x0d,1,
      ...get(2),...i32(8),0x6a,...get(3),...i32(8),0x6c,0x6a,...i64(VALUE_UNDEFINED),...store64,
      ...get(3),...i32(1),0x6a,...set(3),0x0c,0,0x0b,0x0b,...tagFor(VALUE_ARRAY,get(2))
  ])};
  r.Uint8ArrayCreate={params:['f64'],result:'jsval',dependencies:['HeapAlloc'],emit:call=>body(['i32','i32'],[
    ...fail([...get(0),...f64(0),0x63]),...fail([...get(0),...f64(heapBytes-rootBytes-16),0x64]),
    ...get(0),0xfc,3,...set(1),...fail([...get(1),0xb8,...get(0),0x62]),
    ...get(1),...i32(19),0x6a,...i32(-8),0x71,...call('HeapAlloc'),...set(2),...get(2),...get(1),...store,
    ...get(2),...i32(4),0x6a,...i32(0),...get(1),0xfc,11,0,...tagFor(VALUE_UINT8ARRAY,get(2))
  ])};
  const objectPageProperties=8;
  r.ObjectCreate={params:['f64'],result:'jsval',dependencies:['HeapAlloc'],emit:call=>body(['i32','i32'],[
    ...get(0),0xfc,3,...set(1),...fail([...get(1),0xb8,...get(0),0x62]),...i32(objectPageProperties),...set(1),
    ...get(1),...i32(16),0x6c,...i32(24),0x6a,...call('HeapAlloc'),...set(2),
    ...get(2),...i32(0),...store,...get(2),...get(1),...storeAt(4),...get(2),...i64(0n),...store64At(8),
    ...get(2),...i32(16),0x6a,...i32(0),...get(1),...i32(16),0x6c,0xfc,11,0,...tagFor(VALUE_OBJECT,get(2))
  ])};
  r.ObjectGet={params:['jsval','jsval'],result:'jsval',dependencies:['ObjectPointer','StringEqual'],emit:call=>body(['i32','i32','i32'],[
    0x02,0x40,0x03,0x40,
      ...get(0),...call('ObjectPointer'),...set(2),...get(2),...load,...set(3),...i32(0),...set(4),
      0x02,0x40,0x03,0x40,...get(4),...get(3),0x4f,0x0d,1,
        ...get(2),...i32(16),0x6a,...get(4),...i32(16),0x6c,0x6a,...load64,...get(1),...call('StringEqual'),0x04,0x40,
          ...get(2),...i32(24),0x6a,...get(4),...i32(16),0x6c,0x6a,...load64,0x0f,0x0b,
        ...get(4),...i32(1),0x6a,...set(4),0x0c,0,0x0b,0x0b,
      ...get(2),...i32(8),0x6a,...load64,...set(0),...get(0),0xa7,0x45,0x04,0x40,...i64(VALUE_UNDEFINED),0x0f,0x0b,
      0x0c,0,
    0x0b,0x0b,...i64(VALUE_UNDEFINED)
  ])};
  r.ObjectSet={params:['jsval','jsval','jsval'],result:'jsval',dependencies:['ObjectPointer','StringEqual','HeapAlloc'],emit:call=>body(['i32','i32','i32','jsval','i32'],[
    ...get(0),...set(6),
    0x02,0x40,0x03,0x40,...get(6),...call('ObjectPointer'),...set(3),...get(3),...load,...set(4),...i32(0),...set(5),
      0x02,0x40,0x03,0x40,...get(5),...get(4),0x4f,0x0d,1,
        ...get(3),...i32(16),0x6a,...get(5),...i32(16),0x6c,0x6a,...load64,...get(1),...call('StringEqual'),0x04,0x40,
          ...get(3),...i32(24),0x6a,...get(5),...i32(16),0x6c,0x6a,...get(2),...store64,...get(2),0x0f,0x0b,
        ...get(5),...i32(1),0x6a,...set(5),0x0c,0,0x0b,0x0b,
      ...get(4),...i32(8),0x49,0x04,0x40,
        ...get(3),...i32(16),0x6a,...get(4),...i32(16),0x6c,0x6a,...get(1),...store64,
        ...get(3),...i32(24),0x6a,...get(4),...i32(16),0x6c,0x6a,...get(2),...store64,
        ...get(3),...get(4),...i32(1),0x6a,...store,...get(2),0x0f,
      0x0b,
      ...get(3),...i32(8),0x6a,...load64,...set(6),...get(6),0xa7,0x45,0x04,0x40,
        ...i32(152),...call('HeapAlloc'),...set(7),...get(7),...i32(0),...store,...get(7),...i32(8),...storeAt(4),
        ...get(7),...i64(0n),...store64At(8),...get(3),...i32(8),0x6a,...tagFor(VALUE_OBJECT,get(7)),...store64,
        ...tagFor(VALUE_OBJECT,get(7)),...set(6),
      0x05,0x0c,1,0x0b,...get(6),...call('ObjectPointer'),...set(3),...get(3),...load,...set(4),
      ...get(3),...i32(16),0x6a,...get(4),...i32(16),0x6c,0x6a,...get(1),...store64,
      ...get(3),...i32(24),0x6a,...get(4),...i32(16),0x6c,0x6a,...get(2),...store64,
      ...get(3),...get(4),...i32(1),0x6a,...store,0x0c,0,
    0x0b,0x0b,...i64(VALUE_UNDEFINED)
  ])};
  r.ValueIndex={params:['jsval'],result:'i32',dependencies:['ValueToNumber'],emit:call=>body(['f64','i32'],[
    ...get(0),...call('ValueToNumber'),...set(1),
    ...ret([...get(1),...f64(0),0x63],i32(-1)),...get(1),0xfc,3,...set(2),
    ...ret([...get(2),0xb8,...get(1),0x62],i32(-1)),...get(2)
  ])};
  r.ValueLength={params:['jsval'],result:'f64',dependencies:['StringPointer','ArrayPointer','Uint8ArrayPointer'],emit:call=>body([], [
    ...ret(isString(0),[...get(0),...call('StringPointer'),...load,0xb8]),
    ...ret(isTag(0,VALUE_ARRAY),[...get(0),...call('ArrayPointer'),...load,0xb8]),
    ...get(0),...call('Uint8ArrayPointer'),...load,0xb8
  ])};
  r.ValueGetProperty={params:['jsval','jsval'],result:'jsval',dependencies:['ValueLength','ValueBoxNumber','ObjectGet','StringEqual',literal('length')],emit:call=>body([], [
    ...get(1),...call(literal('length')),...call('StringEqual'),
    ...isString(0),...isTag(0,VALUE_ARRAY),0x72,...isTag(0,VALUE_UINT8ARRAY),0x72,0x71,
    0x04,0x7e,...get(0),...call('ValueLength'),...call('ValueBoxNumber'),0x05,...get(0),...get(1),...call('ObjectGet'),0x0b
  ])};
  r.ValueSetProperty={params:['jsval','jsval','jsval'],result:'jsval',dependencies:['ObjectSet'],emit:call=>body([], [...get(0),...get(1),...get(2),...call('ObjectSet')])};
  r.ValueGetIndex={params:['jsval','jsval'],result:'jsval',dependencies:['ValueIndex','ArrayPointer','Uint8ArrayPointer','ValueBoxNumber'],emit:call=>body(['i32','i32'],[
    ...get(1),...call('ValueIndex'),...set(2),...ret([...get(2),...i32(-1),0x46],i64(VALUE_UNDEFINED)),
    ...isTag(0,VALUE_ARRAY),0x04,0x7e,...get(0),...call('ArrayPointer'),...set(3),
      ...get(2),...get(3),...load,0x4f,0x04,0x7e,...i64(VALUE_UNDEFINED),0x05,
        ...get(3),...i32(8),0x6a,...get(2),...i32(8),0x6c,0x6a,...load64,0x0b,
    0x05,...get(0),...call('Uint8ArrayPointer'),...set(3),
      ...get(2),...get(3),...load,0x4f,0x04,0x7e,...i64(VALUE_UNDEFINED),0x05,
        ...get(3),...i32(4),0x6a,...get(2),0x6a,0x2d,0,0,0xb8,...call('ValueBoxNumber'),0x0b,
    0x0b
  ])};
  r.ValueToUint8={params:['jsval'],result:'i32',dependencies:['ValueToNumber'],emit:call=>body(['f64'],[
    ...get(0),...call('ValueToNumber'),...set(1),...ret([...get(1),...get(1),0x62],i32(0)),
    ...fail([...get(1),...f64(-2147483648),0x63]),...fail([...get(1),...f64(2147483647),0x64]),
    ...get(1),0xfc,2,...i32(255),0x71
  ])};
  r.ValueSetIndex={params:['jsval','jsval','jsval'],result:'jsval',dependencies:['ValueIndex','ArrayPointer','Uint8ArrayPointer','ValueToUint8'],emit:call=>body(['i32','i32'],[
    ...get(1),...call('ValueIndex'),...set(3),
    ...isTag(0,VALUE_ARRAY),0x04,0x40,...fail([...get(3),...i32(-1),0x46]),...get(0),...call('ArrayPointer'),...set(4),
      ...fail([...get(3),...get(4),...load,0x4f]),...get(4),...i32(8),0x6a,...get(3),...i32(8),0x6c,0x6a,...get(2),...store64,...get(2),0x0f,0x0b,
    ...get(0),...call('Uint8ArrayPointer'),...set(4),
    ...get(3),...i32(-1),0x47,...get(3),...get(4),...load,0x49,0x71,0x04,0x40,
      ...get(4),...i32(4),0x6a,...get(3),0x6a,...get(2),...call('ValueToUint8'),0x3a,0,0,0x0b,...get(2)
  ])};
  r.StringLength={params:['jsval'],result:'f64',dependencies:['StringPointer'],emit:call=>body([], [...get(0),...call('StringPointer'),...load,0xb8])};
  r.StringEqual={params:['jsval','jsval'],result:'i32',dependencies:['StringPointer'],emit:call=>body(['i32','i32','i32','i32'],[
    ...get(0),...call('StringPointer'),...set(2),...get(1),...call('StringPointer'),...set(3),...get(2),...load,...set(4),...ret([...get(4),...get(3),...load,0x47],i32(0)),
    0x02,0x40,0x03,0x40,...get(5),...get(4),0x4f,0x0d,1,...get(2),...get(5),...i32(2),0x6c,0x6a,0x2f,1,4,...get(3),...get(5),...i32(2),0x6c,0x6a,0x2f,1,4,
    ...ret([0x47],i32(0)),...get(5),...i32(1),0x6a,...set(5),0x0c,0,0x0b,0x0b,...i32(1)
  ])};
  r.StringConcat={params:['jsval','jsval'],result:'jsval',dependencies:['StringPointer','StringAlloc','RootPush','RootPop'],emit:call=>body(['i32','i32','i32','i32','i32'],[
    ...get(0),...call('RootPush'),...get(1),...call('RootPush'),...get(0),...call('StringPointer'),...set(2),...get(1),...call('StringPointer'),...set(3),
    ...get(2),...load,...set(4),...get(3),...load,...set(5),...get(4),...get(5),0x6a,...call('StringAlloc'),...set(6),
    ...get(6),...i32(4),0x6a,...get(2),...i32(4),0x6a,...get(4),...i32(2),0x6c,0xfc,10,0,0,
    ...get(6),...i32(4),0x6a,...get(4),...i32(2),0x6c,0x6a,...get(3),...i32(4),0x6a,...get(5),...i32(2),0x6c,0xfc,10,0,0,
    ...call('RootPop'),...call('RootPop'),...tag(get(6))
  ])};
  for(const [text,{name,global}] of literals){
    if(text.length>(heapBytes-rootBytes-16)/2)throw new RangeError('String literal exceeds the bounded heap');
    r[name]={params:[],result:'jsval',dependencies:['StringAlloc'],emit:call=>{const c=[...ret(gg(global),tag(gg(global))),...i32(text.length),...call('StringAlloc'),...set(0)];for(let i=0;i<text.length;i++)c.push(...get(0),...i32(text.charCodeAt(i)),0x3b,1,...uleb(4+i*2));c.push(...get(0),...gs(global),...tag(get(0)));return body(['i32'],c);}};
  }
  r.ValueToString={params:['jsval'],result:'jsval',dependencies:['StringPointer','StringAlloc','ValueToNumber',...['true','false','null','undefined'].map(literal)],emit:call=>body(['i32','i32'],[
    ...ret(isString(0),[...get(0),...call('StringPointer'),0x1a,...get(0)]),...ret(eq(0,VALUE_NULL),call(literal('null'))),...ret(eq(0,VALUE_UNDEFINED),call(literal('undefined'))),
    ...ret(eq(0,VALUE_FALSE),call(literal('false'))),...ret(eq(0,VALUE_TRUE),call(literal('true'))),...i32(64),...call('StringAlloc'),...set(1),
    ...get(0),...call('ValueToNumber'),...get(1),...i32(4),0x6a,...call('FormatNumber'),...set(2),...fail([...get(2),...i32(64),0x4b]),...get(1),...get(2),...store,...tag(get(1))
  ])};
  r.ValueAdd={params:['jsval','jsval'],result:'jsval',dependencies:['ValueToString','StringConcat','ValueToNumber','ValueBoxNumber','RootPush','RootPop'],emit:call=>body(['jsval','jsval','jsval'],[
    ...isString(0),...isString(1),0x72,0x04,0x7e,...get(0),...call('ValueToString'),...set(2),...get(2),...call('RootPush'),
    ...get(1),...call('ValueToString'),...set(3),...get(3),...call('RootPush'),...get(2),...get(3),...call('StringConcat'),...set(4),
    ...call('RootPop'),...call('RootPop'),...get(4),0x05,...get(0),...call('ValueToNumber'),...get(1),...call('ValueToNumber'),0xa0,...call('ValueBoxNumber'),0x0b
  ])};
  r.PrimitiveTruthy=primitiveHelpers.ValueTruthy;
  r.ValueTruthy={params:['jsval'],result:'i32',dependencies:['StringPointer','ArrayPointer','Uint8ArrayPointer','ObjectPointer','PrimitiveTruthy'],emit:call=>body([], [
    ...ret(isString(0),[...get(0),...call('StringPointer'),...load,0x45,0x45]),
    ...ret(isTag(0,VALUE_ARRAY),[...get(0),...call('ArrayPointer'),0x1a,...i32(1)]),
    ...ret(isTag(0,VALUE_UINT8ARRAY),[...get(0),...call('Uint8ArrayPointer'),0x1a,...i32(1)]),
    ...isTag(0,VALUE_OBJECT),...get(0),0xa7,0x45,0x45,0x71,0x04,0x40,...get(0),...call('ObjectPointer'),0x1a,...i32(1),0x0f,0x0b,
    ...get(0),...call('PrimitiveTruthy')
  ])};
  r.PrimitiveEqual=primitiveHelpers.ValueStrictEqual;
  r.ValueStrictEqual={params:['jsval','jsval'],result:'i32',dependencies:['StringPointer','StringEqual','ValueToNumber','PrimitiveEqual'],emit:call=>body([], [
    ...isString(0),0x04,0x40,...get(0),...call('StringPointer'),0x1a,...ret(isString(1),[...get(0),...get(1),...call('StringEqual')]),...get(1),...call('ValueToNumber'),0x1a,...i32(0),0x0f,0x0b,
    ...ret(isString(1),[...get(1),...call('StringPointer'),0x1a,...get(0),...call('ValueToNumber'),0x1a,...i32(0)]),...get(0),...get(1),...call('PrimitiveEqual')
  ])};
  r.PrimitivePrint=primitiveHelpers.PrintValue;
  r.PrintValue={params:['jsval'],result:'none',dependencies:['StringPointer','PrimitivePrint'],emit:call=>body(['i32'],[
    ...isString(0),0x04,0x40,...get(0),...call('StringPointer'),...set(1),...get(1),...i32(4),0x6a,...get(1),...load,...call('PrintString'),0x0f,0x0b,...get(0),...call('PrimitivePrint')
  ])};
  return {registry:r,literals,globalCount:literals.size+4,rootBytes,heapBytes};
}
