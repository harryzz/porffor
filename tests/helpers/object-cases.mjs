export const objectCases=[
 {name:'literal-and-missing',source:'let o={a:1,b:"two",c:null};console.log(o.a);console.log(o.b);console.log(o.c);console.log(o.missing);',expected:[1,'two',null,undefined]},
 {name:'fixed-computed-name',source:'let o={"dash-key":"yes",plain:2};console.log(o["dash-key"]);o["dash-key"]="changed";console.log(o["dash-key"]);',expected:['yes','changed']},
 {name:'dynamic-string-key',source:'let key="name";let o={name:"before"};console.log(o[key]);o[key]="after";console.log(o.name);let second="added";o[second]=3;console.log(o["added"]);',expected:['before','after',3]},
 {name:'mutation-and-new-property',source:'let o={a:1};console.log(o.a=4);o.b="new";console.log(o.a);console.log(o.b);',expected:[4,4,'new']},
 {name:'shorthand-and-duplicate',source:'let a=7;let o={a,a:8};console.log(o.a);',expected:[8]},
 {name:'calls',source:'function get(o){return o.value;}function set(o,v){o.value=v;return o.value;}let o={value:2};console.log(get(o));console.log(set(o,"ok"));console.log(get(o));',expected:[2,'ok','ok']},
 {name:'truthiness',source:'let o={};if(o)console.log(true);console.log(!o);',expected:[true,false]},
 {name:'length-data-property',source:'let o={length:7};let a=[1,2];console.log(o.length);console.log(a.length);console.log("abc".length);',expected:[7,2,3]},
 {name:'nested-fixed-properties',source:'let inner={value:"inside"};let outer={child:inner};console.log(outer.child.value);outer.child.value="updated";console.log(inner.value);',expected:['inside','updated']},
 {name:'literal-order',source:'function mark(x){console.log(x);return x;}let o={a:mark(1),b:mark(2)};console.log(o.a);console.log(o.b);',expected:[1,2,1,2]},
 {name:'retained-property',source:'let o={child:"live"};for(let i=0;i<400;i++){let garbage="discard="+i;}console.log(o.child);',expected:['live']},
];
