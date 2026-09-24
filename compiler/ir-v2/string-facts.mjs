// Conservative closed-program propagation for heap-bearing values. This is
// intentionally not path-sensitive; unsupported coercions fail before lowering.
export function checkHeapUses(mod) {
  const facts=new Map(),funcs=new Map(mod.functions.map(f=>[f.name,f])),elements=new Set(),properties=new Map(),dynamicProperties=new Set();
  const key=(f,id)=>`${f.name}:${id}`,result=f=>key(f,'$result'),get=k=>facts.get(k)??new Set();
  let changed;
  const add=(k,types)=>{if(!facts.has(k))facts.set(k,new Set());for(const t of types)if(!facts.get(k).has(t)){facts.get(k).add(t);changed=true;}};
  do {
    changed=false;
    for(const f of mod.functions){
      const blocks=new Map(f.blocks.map(b=>[b.id,b]));
      const edge=(target,args)=>args.forEach((id,i)=>add(key(f,blocks.get(target).params[i].id),get(key(f,id))));
      for(const b of f.blocks){
        for(const n of b.instructions){
          const args=n.args.map(id=>get(key(f,id))),dest=key(f,n.id);
          if(n.op==='JsDirectCall'){
            const callee=funcs.get(n.callee);n.args.forEach((id,i)=>add(key(callee,callee.params[i].id),get(key(f,id))));
            if(n.id!==null)add(dest,get(result(callee)));
          }else if(n.op==='JsAdd'){
            if(args.some(s=>s.has('string')))add(dest,['string']);
            if(args.every(s=>[...s].some(t=>t!=='string')))add(dest,['number']);
          }else if(n.op==='JsArray'){
            add(dest,['array']);for(const a of args)for(const t of a)if(!elements.has(t)){elements.add(t);changed=true;}
          }else if(n.op==='JsUint8Array')add(dest,['uint8array']);
          else if(n.op==='JsObject'){
            add(dest,['object']);n.keys.forEach((name,i)=>{if(!properties.has(name))properties.set(name,new Set());for(const t of args[i])if(!properties.get(name).has(t)){properties.get(name).add(t);changed=true;}});
          }else if(n.op==='JsObjectCreate')add(dest,['object']);
          else if(n.op==='JsPropertySet'){
            add(dest,args[1]);if(!properties.has(n.key))properties.set(n.key,new Set());for(const t of args[1])if(!properties.get(n.key).has(t)){properties.get(n.key).add(t);changed=true;}
          }else if(n.op==='JsPropertyGet'){
            if(n.key==='length'&&[...args[0]].some(t=>t==='string'||t==='array'||t==='uint8array'))add(dest,['number']);
            if(args[0].has('object'))add(dest,properties.get(n.key)??[]);
          }else if(n.op==='JsDynamicPropertyGet'){
            if(args[0].has('object')&&args[1].has('string'))add(dest,[...new Set([...properties.values()].flatMap(s=>[...s])),...dynamicProperties]);
            if(args[0].has('array'))add(dest,[...elements,'undefined']);
            if(args[0].has('uint8array'))add(dest,['number','undefined']);
          }else if(n.op==='JsDynamicPropertySet'){
            add(dest,args[2]);for(const t of args[2])if(!dynamicProperties.has(t)){dynamicProperties.add(t);changed=true;}
          }else if(n.op==='JsIndexGet'){
            if(args[0].has('uint8array'))add(dest,['number','undefined']);
            if(args[0].has('array'))add(dest,[...elements,'undefined']);
          }else if(n.op==='JsIndexSet')add(dest,args[2]);
          else if(n.type!=='none'){
            const type=n.op==='JsString'?'string':n.op==='JsNull'?'null':n.op==='JsUndefined'?'undefined':
              /Js(Boolean|Not|StrictEqual|StrictNotEqual|LessThan|LessEqual|GreaterThan|GreaterEqual)$/.test(n.op)?'boolean':'number';
            add(dest,[type]);
          }
        }
        const t=b.terminator;
        if(t.op==='Return'&&t.value!==null)add(result(f),get(key(f,t.value)));
        else if(t.op==='Branch')edge(t.target,t.args);
        else if(t.op==='ConditionalBranch'){edge(t.thenTarget,t.thenArgs);edge(t.elseTarget,t.elseArgs);}
      }
    }
  }while(changed);
  for(const f of mod.functions)for(const b of f.blocks)for(const n of b.instructions){
    if(n.op==='JsDynamicPropertyGet'||n.op==='JsDynamicPropertySet'){
      const receiver=get(key(f,n.args[0])),index=get(key(f,n.args[1]));
      if(receiver.size&&[...receiver].every(t=>t==='array'||t==='uint8array')&&index.size&&[...index].every(t=>t==='number'))n.op=n.op==='JsDynamicPropertyGet'?'JsIndexGet':'JsIndexSet';
    }
  }
  const heap=new Set(['string','array','uint8array','object']),containers=new Set(['string','array','uint8array']);
  const only=(set,allowed)=>set.size>0&&[...set].every(x=>allowed.has(x));
  const safe=new Set(['JsAdd','JsPrint','JsNot','JsStrictEqual','JsStrictNotEqual','JsDirectCall','JsArray','JsUint8Array','JsObject','JsObjectCreate','JsIndexGet','JsIndexSet','JsPropertyGet','JsPropertySet','JsDynamicPropertyGet','JsDynamicPropertySet','JsStringLength']);
  for(const f of mod.functions)for(const b of f.blocks)for(const n of b.instructions){
    const args=n.args.map(id=>get(key(f,id)));
    if(n.op==='JsStringLength'&&!only(args[0],containers))throw new TypeError('Heap lowering: .length requires a proven string or array');
    if(n.op==='JsPropertyGet'){
      const allowed=n.key==='length'?new Set(['string','array','uint8array','object']):new Set(['object']);
      if(!only(args[0],allowed))throw new TypeError(`Heap lowering: property ${n.key} requires a proven object`);
    }
    if(n.op==='JsPropertySet'&&!only(args[0],new Set(['object'])))throw new TypeError('Heap lowering: property assignment requires a proven object');
    if(n.op==='JsObjectCreate'&&!only(args[0],new Set(['object','null'])))throw new TypeError('Heap lowering: Object.create prototype must be an object or null');
    if(n.op==='JsDynamicPropertyGet'&&(!only(args[0],new Set(['object']))||!only(args[1],new Set(['string']))))throw new TypeError('Heap lowering: dynamic property access requires an object and string key');
    if(n.op==='JsDynamicPropertySet'&&(!only(args[0],new Set(['object']))||!only(args[1],new Set(['string']))))throw new TypeError('Heap lowering: dynamic property assignment requires an object and string key');
    if((n.op==='JsIndexGet'||n.op==='JsIndexSet')&&!only(args[0],new Set(['array','uint8array'])))throw new TypeError('Heap lowering: indexed access requires a proven array');
    if((n.op==='JsIndexGet'||n.op==='JsIndexSet')&&[...args[1]].some(x=>heap.has(x)))throw new TypeError('Heap lowering: string/object array indices are unsupported');
    if(n.op==='JsUint8Array'&&[...args[0]].some(x=>heap.has(x)))throw new TypeError('Heap lowering: Uint8Array length must be primitive numeric');
    if(n.op==='JsPrint'&&args[0]&&[...args[0]].some(x=>x==='array'||x==='uint8array'||x==='object'))throw new TypeError('Heap lowering: direct object printing is unsupported');
    if((n.op==='JsStrictEqual'||n.op==='JsStrictNotEqual')&&args.some(s=>[...s].some(x=>x==='array'||x==='uint8array'||x==='object')))throw new TypeError('Heap lowering: object identity equality is not implemented');
    if(n.op==='JsAdd'&&args.some(s=>[...s].some(x=>x==='array'||x==='uint8array'||x==='object')))throw new TypeError('Heap lowering: object coercion is unsupported');
    if(!safe.has(n.op)&&args.some(s=>[...s].some(x=>heap.has(x))))throw new TypeError(`Heap lowering: numeric conversion/order on heap values is unsupported (${n.op})`);
  }
}

export const checkStringUses=checkHeapUses;
