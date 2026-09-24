export const closureCases=[
 {name:'arrow-captures-const',source:'const base=40;const add=(x)=>x+base;console.log(add(2));',expected:[42]},
 {name:'independent-closure-environments',source:'const left=2;const right=7;const add=x=>x+left;const multiply=x=>x*right;console.log(add(3));console.log(multiply(3));',expected:[5,21]},
 {name:'runtime-selects-between-closure-targets',source:'const left=2;const right=5;let f=x=>x+left;if(true)f=x=>x+right;console.log(f(3));',expected:[8]},
 {name:'returned-closure-survives-collection',source:'function make(){const base=39;return x=>x+base;}const add=make();for(let i=0;i<400;i++){let garbage="g="+i;}console.log(add(3));',expected:[42]},
 {name:'captured-string-survives-collection',source:'function make(){const word="hello";return ()=>word;}const get=make();for(let i=0;i<400;i++){let garbage="g="+i;}console.log(get());',expected:['hello']},
 {name:'block-arrow-body',source:'const offset=4;const add=(x)=>{return x+offset;};console.log(add(5));',expected:[9]},
];
