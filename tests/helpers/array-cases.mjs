export const arrayCases=[
 {name:'dense-mixed',source:'let a=[1,"two",null,true,undefined];console.log(a.length);console.log(a[0]);console.log(a[1]);console.log(a[2]);console.log(a[3]);console.log(a[4]);',expected:[5,1,'two',null,true,undefined]},
 {name:'mutation',source:'let a=[1,2,3];console.log(a[1]=9);console.log(a[1]);a[0]="x";console.log(a[0]);console.log(a.length);',expected:[9,9,'x',3]},
 {name:'reads',source:'let a=[4,5];console.log(a[0]);console.log(a[1]);console.log(a[2]);console.log(a[-1]);console.log(a[0.5]);',expected:[4,5,undefined,undefined,undefined]},
 {name:'calls',source:'function get(a,i){return a[i];}function set(a,i,v){a[i]=v;return a;}let a=[2,4];console.log(get(a,1));set(a,0,"ok");console.log(get(a,0));',expected:[4,'ok']},
 {name:'truthiness',source:'let a=[];if(a)console.log(true);console.log(!a);console.log(a.length);',expected:[true,false,0]},
 {name:'retained-child',source:'let a=["live"];for(let i=0;i<400;i++){let garbage="discard="+i;}console.log(a[0]);',expected:['live']},
 {name:'mutated-child',source:'let a=[null];a[0]="ke"+"ep";for(let i=0;i<400;i++){let garbage="trash="+i;}console.log(a[0]);',expected:['keep']},
 {name:'uint8-zero-and-write',source:'let a=new Uint8Array(4);console.log(a.length);console.log(a[0]);console.log(a[1]=257);console.log(a[1]);a[2]=-1;a[3]=12.9;console.log(a[2]);console.log(a[3]);',expected:[4,0,257,1,255,12]},
 {name:'uint8-oob',source:'let a=new Uint8Array(2);a[9]=7;a[-1]=8;console.log(a[9]);console.log(a[-1]);console.log(a[0]);console.log(a.length);',expected:[undefined,undefined,0,2],legacySignal:'SIGSEGV',legacyIssue:'retained C typed-array access does not guard out-of-bounds indices'},
 {name:'uint8-nan',source:'let a=new Uint8Array(2);a[0]=NaN;a[1]=-0;console.log(a[0]);console.log(a[1]);if(a)console.log(true);',expected:[0,0,true]},
];
