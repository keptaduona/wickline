import assert from 'node:assert/strict';
import { DrawingLayer } from '../public/js/drawings.js';
import { measurementStats, measurementDuration, measurementText } from '../public/js/measurement.js';
import { ShiftDragMeasure } from '../public/js/shift-measure.js';
let n=0;
const ok=(name,fn)=>{fn();n++;console.log(`  ok ${name}`)};
function layer(){
 const l=new DrawingLayer({formatPrice:v=>v.toFixed(2)});
 l.attached({chart:{timeScale:()=>({coordinateToLogical:x=>x/10,logicalToCoordinate:x=>x*10,width:()=>800})},series:{coordinateToPrice:y=>100-y/10,priceToCoordinate:p=>(100-p)*10,options:()=>({priceFormat:{minMove:.01}})},requestUpdate(){}});
 l.setBars(Array.from({length:100},(_,i)=>({time:i*3600,open:50,high:60,low:40,close:55})));l.setContext('MEASURE-TEST',3600);return l;
}
const stats=(a,b,minMove=.01)=>measurementStats(a,b,t=>t/3600,minMove);
ok('upward measurement reports signed delta, percentage, ticks, interval count and real duration',()=>{
 const s=stats({time:0,price:100},{time:115200,price:110});assert.deepEqual(s,{delta:10,percent:10,bars:32,seconds:115200,ticks:1000});
 assert.equal(measurementText(s,v=>v.toFixed(2)),'+10.00 (+10.00%) +1,000\n32 bars, 1d 8h');
});
ok('reverse horizontal dragging keeps interval count and time positive without changing the price direction',()=>{
 const s=stats({time:52*86400,price:100},{time:0,price:80});assert.equal(s.bars,1248);assert.equal(s.seconds,52*86400);assert.equal(s.percent,-20);assert.equal(s.ticks,-2000);
 assert.ok(measurementText(s,String).includes('-20 (-20.00%) -2,000'));
});
ok('zero and negative starting prices never produce an infinite or inverted percentage',()=>{
 const s=stats({time:0,price:0},{time:3600,price:5});assert.equal(s.percent,null);assert.ok(measurementText(s,String).includes('(—)'));
 assert.equal(stats({time:0,price:-100},{time:3600,price:-90}).percent,10);
});
ok('tick counts use the instrument minimum move and are omitted when it is unknown',()=>{
 const a={time:0,price:100},b={time:3600,price:100.5};assert.equal(stats(a,b,.25).ticks,2);
 assert.equal(measurementStats(a,b,t=>t/3600,undefined).ticks,null);assert.equal(stats(a,b,0).ticks,null);
});
ok('combined duration does not round 1 day 8 hours into 1 day or 32 hours',()=>{
 assert.equal(measurementDuration(115200),'1d 8h');assert.equal(measurementDuration(52*86400),'52d');
 assert.equal(measurementDuration(3661),'1h 1m 1s');assert.equal(measurementDuration(59),'59s');assert.equal(measurementDuration(0),'0s');
});
ok('bar count follows actual bar indexes rather than counting non-trading hours as candles',()=>{
 const s=measurementStats({time:0,price:10},{time:3*86400,price:11},t=>t===0?0:1,.01);assert.equal(s.bars,1);assert.equal(s.seconds,3*86400);
});
ok('temporary measurement never changes selection, saved drawings or undo history',()=>{
 const saved=new Map();globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v))};
 try{const l=layer();l.items=[{id:'keep',type:'hline',p1:{time:0,price:50},p2:{time:0,price:50},color:'#4FA3F7'}];l.select('keep');l._changed(true);
 const store=JSON.stringify([...saved]),history=JSON.stringify([...l._histories]);assert.ok(l.beginMeasurement(100,530));l.moveMeasurement(420,400);l.endMeasurement();
 assert.equal(l.measurement.p2.time-l.measurement.p1.time,32*3600);assert.equal(l.selectedId,'keep');assert.equal(l.items.length,1);assert.equal(l.tool,'cursor');
 assert.equal(JSON.stringify([...saved]),store);assert.equal(JSON.stringify([...l._histories]),history);assert.equal(l.measuring,false);assert.ok(l.measurement);
 }finally{delete globalThis.localStorage}
});
ok('measurement snaps time to bars but does not use the drawing magnet',()=>{
 const l=layer();l.setMagnet('strong');assert.ok(l.beginMeasurement(103,523));assert.equal(l.measurement.p1.time,36000);assert.equal(l.measurement.p1.price,47.7);
 l.moveMeasurement(106,530);assert.equal(l.measurement.p2.time,39600);
});
ok('ordinary drawing clicks and drags are frozen only during the temporary gesture',()=>{
 const l=layer();l.items=[{id:'line',type:'hline',p1:{time:0,price:50},p2:{time:0,price:50},color:'#4FA3F7'}];l.beginMeasurement(100,530);
 assert.equal(l.beginDrag(100,500),false);assert.equal(l.handleClick({point:{x:100,y:500}}),false);l.endMeasurement();assert.equal(l.handleClick({point:{x:100,y:500}}),true);
});
ok('drawing bodies and selected control points keep their normal Shift editing and selection',()=>{
 const l=layer();l.items=[{id:'keep',type:'trend',p1:{time:36000,price:50},p2:{time:72000,price:40},color:'#4FA3F7'}];
 assert.equal(l.beginMeasurement(150,550),false);l.select('keep');assert.equal(l.beginMeasurement(100,500),false);assert.equal(l.measurement,null);
 assert.ok(l.beginDrag(100,500));l.dragMove(120,560,true);assert.equal(l.selected.p1.price,l.selected.p2.price);l.endDrag();
});
ok('a selected drawing tool or unfinished drawing cannot start temporary measurement',()=>{
 const l=layer();l.setTool('trend');assert.equal(l.beginMeasurement(100,500),false);l.handleClick({point:{x:100,y:500}});
 const p=JSON.stringify(l.pending);assert.equal(l.beginMeasurement(100,500),false);assert.equal(JSON.stringify(l.pending),p);
});
ok('clear, tool switch, symbol change and detach discard only the ephemeral measurement',()=>{
 for(const action of ['clear','tool','context','detach']){const l=layer();l.beginMeasurement(100,500);l.moveMeasurement(300,400);l.endMeasurement();
 if(action==='clear')assert.equal(l.clearMeasurement(),true);if(action==='tool')l.setTool('rect');if(action==='context')l.setContext('OTHER',3600);if(action==='detach')l.detached();
 assert.equal(l.measurement,null);assert.equal(l.measuring,false);assert.equal(l.items.length,0)}
});
ok('Escape through DrawingLayer.cancel clears the measurement before an unrelated selection',()=>{
 const l=layer();l.selectedId='selected';l.beginMeasurement(100,500);l.endMeasurement();assert.ok(l.cancel());assert.equal(l.selectedId,'selected');assert.equal(l.measurement,null);
});
ok('measurement renderer draws a box, directional arrows and a bounded two-line readout',()=>{
 const l=layer();l.beginMeasurement(700,50);l.moveMeasurement(790,0);l.endMeasurement();const calls=[];
 const ctx=new Proxy({},{get:(_,k)=>k==='measureText'?s=>({width:String(s).length*7}):(...a)=>calls.push([k,...a]),set:(_,k,v)=>{calls.push(['set',k,v]);return true}});
 l._draw({useMediaCoordinateSpace:fn=>fn({context:ctx,mediaSize:{width:800,height:600}})});
 assert.ok(calls.some(c=>c[0]==='fillRect'));assert.equal(calls.filter(c=>c[0]==='fillText').length,2);assert.ok(calls.filter(c=>c[0]==='lineTo').length>=6);
 const badge=calls.find(c=>c[0]==='roundRect');assert.ok(badge[1]>=0&&badge[2]>=0&&badge[1]+badge[3]<=800&&badge[2]+badge[4]<=600);
 assert.ok(calls.some(c=>c[0]==='fillText'&&String(c[1]).includes('+')));
});
function gesture(){
 const win=new EventTarget(),doc=new EventTarget(),host=new EventTarget(),classes=new Set(),l=layer();win.innerWidth=1600;win.innerHeight=900;
 doc.defaultView=win;host.ownerDocument=doc;host.contains=target=>target===host;host.classList={add:k=>classes.add(k),remove:k=>classes.delete(k)};host.setPointerCapture=()=>{};host.releasePointerCapture=()=>{};
 let enabled=true;const c=new ShiftDragMeasure(host,l,{canStart:()=>enabled&&l.tool==='cursor'&&!l.drag&&!l.pending,pointAt:(e,outside)=>!outside&&(e.clientX<0||e.clientX>800||e.clientY<0||e.clientY>600)?null:{x:Math.max(0,Math.min(800,e.clientX)),y:Math.max(0,Math.min(600,e.clientY))}});
 const fire=(target,type,values={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:7,pointerType:'mouse',button:0,buttons:1,shiftKey:true,clientX:100,clientY:500,...values});target.dispatchEvent(e);return e};
 return{win,doc,host,l,c,classes,fire,disable:()=>{enabled=false}};
}
ok('Shift-left click anchors, free movement tracks without held keys or buttons, and a second click completes',()=>{
 const g=gesture();assert.ok(g.fire(g.host,'pointerdown').defaultPrevented);assert.ok(g.classes.has('shift-measuring'));
 const start=JSON.stringify(g.l.measurement.p1);g.fire(g.win,'pointerup',{buttons:0});g.fire(g.win,'keyup',{key:'Shift',shiftKey:false});
 assert.ok(g.c.session);assert.equal(g.c.session.captured,false);assert.equal(g.l.measuring,true);
 g.fire(g.win,'pointermove',{clientX:420,clientY:400,buttons:0,shiftKey:false});
 assert.equal(JSON.stringify(g.l.measurement.p1),start);assert.equal(g.l.measurement.p2.time,42*3600);assert.ok(g.fire(g.host,'click').defaultPrevented);
 assert.ok(g.fire(g.host,'pointerdown',{clientX:450,clientY:390,shiftKey:false}).defaultPrevented);
 assert.equal(g.c.session,null);assert.equal(g.l.measuring,false);assert.equal(g.classes.size,0);assert.equal(g.l.measurement.p2.time,45*3600);
 const completed=JSON.stringify(g.l.measurement);g.fire(g.win,'pointermove',{clientX:600,clientY:300,buttons:0,shiftKey:false});assert.equal(JSON.stringify(g.l.measurement),completed);
 assert.ok(g.fire(g.host,'click',{shiftKey:false}).defaultPrevented);g.fire(g.win,'pointerdown',{shiftKey:false});assert.equal(g.l.measurement,null);g.c.destroy();
});
ok('plain left, other buttons, touch, extra modifiers and chart axes retain their existing behavior',()=>{
 for(const values of [{shiftKey:false},{button:1},{button:2},{pointerType:'touch'},{ctrlKey:true},{altKey:true},{metaKey:true},{buttons:3},{clientX:900}]){
 const g=gesture();assert.equal(g.fire(g.host,'pointerdown',values).defaultPrevented,false);assert.equal(g.c.session,null);g.c.destroy()}
});
ok('the first Shift-click remains armed at its anchor; a second click at the same position clears an empty result',()=>{
 const g=gesture();g.fire(g.host,'pointerdown');g.fire(g.win,'pointerup',{buttons:0});assert.ok(g.l.measurement);assert.ok(g.c.session);
 g.fire(g.host,'pointerdown',{shiftKey:false});assert.equal(g.l.measurement,null);assert.equal(g.c.session,null);g.c.destroy();
});
ok('releasing Shift before or after the first mouse release never completes the measurement',()=>{
 for(const first of ['shift','mouse']){const g=gesture();g.fire(g.host,'pointerdown');
 if(first==='shift')g.fire(g.win,'keyup',{key:'Shift',shiftKey:false});
 g.fire(g.win,'pointerup',{buttons:0,shiftKey:false});g.fire(g.win,'keyup',{key:'Shift',shiftKey:false});
 assert.ok(g.c.session);assert.equal(g.l.measuring,true);g.fire(g.win,'pointermove',{clientX:420,clientY:400,buttons:0,shiftKey:false});
 assert.equal(g.l.measurement.p2.time,42*3600);g.fire(g.host,'pointerdown',{clientX:420,clientY:400,shiftKey:false});assert.equal(g.c.session,null);assert.ok(g.l.measurement);g.c.destroy()}
});
ok('expected capture loss after the first click does not cancel free endpoint tracking',()=>{
 const g=gesture();g.fire(g.host,'pointerdown');g.fire(g.win,'pointerup',{buttons:0});g.fire(g.host,'lostpointercapture');
 assert.ok(g.c.session);g.fire(g.win,'pointermove',{clientX:420,clientY:400,buttons:0,shiftKey:false});assert.equal(g.l.measurement.p2.time,42*3600);g.c.destroy();
});
ok('Escape clears an active or retained measurement without propagating to drawing selection',()=>{
 for(const retained of [false,true]){const g=gesture();g.fire(g.host,'pointerdown');g.fire(g.win,'pointermove',{clientX:420,clientY:400});if(retained)g.fire(g.host,'pointerdown',{clientX:420,clientY:400,shiftKey:false});
 assert.ok(g.fire(g.win,'keydown',{key:'Escape'}).defaultPrevented);assert.equal(g.l.measurement,null);assert.equal(g.c.session,null);g.c.destroy()}
});
for(const type of ['blur','pagehide','pointercancel','mouseout','lostpointercapture'])ok(`${type} cannot leave capture, cursor or measurement stuck`,()=>{
 const g=gesture();g.fire(g.host,'pointerdown');g.fire(g.win,'pointermove',{clientX:420,clientY:400});g.fire(type==='lostpointercapture'?g.host:g.win,type,{relatedTarget:null});
 assert.equal(g.l.measurement,null);assert.equal(g.c.session,null);assert.equal(g.classes.size,0);g.c.destroy();
});
ok('hidden documents, incompatible buttons and coordinates outside the window cancel safely',()=>{
 for(const mode of ['hidden','buttons','outside']){const g=gesture();g.fire(g.host,'pointerdown');
 if(mode==='hidden'){g.doc.hidden=true;g.fire(g.doc,'visibilitychange')}else g.fire(g.win,'pointermove',mode==='buttons'?{buttons:2}:{clientX:-20});
 assert.equal(g.c.session,null);assert.equal(g.l.measurement,null);g.c.destroy()}
});
ok('foreign pointer events cannot update or release the measurement',()=>{
 const g=gesture();g.fire(g.host,'pointerdown');g.fire(g.win,'pointermove',{pointerId:99,clientX:400});g.fire(g.win,'pointerup',{pointerId:99});
 assert.ok(g.c.session);assert.equal(g.l.measurement.p2.time,g.l.measurement.p1.time);g.c.destroy();
});
ok('crossing another chart clamps to the original plot instead of measuring its coordinates',()=>{
 const g=gesture();g.fire(g.host,'pointerdown');g.fire(g.win,'pointermove',{clientX:1200,clientY:800});g.fire(g.win,'pointerup',{clientX:1200,clientY:800});
 assert.ok(g.c.session);assert.equal(g.l.measurement.p2.time,80*3600);assert.equal(g.l.measurement.p2.price,40);g.c.destroy();
});
ok('symbol, series or interaction-mode replacement invalidates the gesture',()=>{
 for(const key of ['key','series','mode']){const g=gesture();g.fire(g.host,'pointerdown');if(key==='mode')g.disable();else g.l[key]=key==='key'?'OTHER':{};
 g.fire(g.win,'pointermove',{clientX:400,clientY:400});assert.equal(g.c.session,null);assert.equal(g.l.measurement,null);g.c.destroy()}
});
ok('destroy removes gesture listeners, and capture failure is cleaned up',()=>{
 const g=gesture();g.c.destroy();assert.equal(g.fire(g.host,'pointerdown').defaultPrevented,false);assert.equal(g.c.session,null);
 const h=gesture();h.host.setPointerCapture=()=>{throw Error('lost')};h.fire(h.host,'pointerdown');assert.equal(h.c.session,null);assert.equal(h.l.measurement,null);h.c.destroy();
});
console.log(`shift measure: ${n} checks passed`);
