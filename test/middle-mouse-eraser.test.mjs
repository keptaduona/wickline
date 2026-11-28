// Drawing hit/deletion/persistence and the temporary pointer gesture, without a chart renderer.
import assert from 'node:assert/strict';
import { DrawingLayer, TOOLS } from '../public/js/drawings.js';
import { eraseAlong, MiddleMouseEraser } from '../public/js/middle-mouse-eraser.js';
import { hitIndicator } from '../public/js/indicator-hit-test.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok ${name}`); };
const point = (x, y) => ({ time: x * 100, price: 100 - y / 10 });
const drawing = (id, type = 'vline', x = 200, y = 300) => ({ id, type, color: '#4FA3F7',
  p1: point(x, y), p2: point(x + 200, y + 200), p3: point(x, y - 200) });
function layer() {
  const result = new DrawingLayer({ formatPrice: String });
  result.attached({ chart: { timeScale: () => ({ coordinateToLogical: (x) => x / 10, logicalToCoordinate: (x) => x * 10, width: () => 800 }) },
    series: { priceToCoordinate: (p) => (100 - p) * 10, coordinateToPrice: (y) => 100 - y / 10 }, requestUpdate() {} });
  result.setBars(Array.from({length:100}, (_, i) => ({ time:i*1000, open:50, high:60, low:40, close:55, volume:1000 })));
  result.setContext('ERASER-UNIT', 1000);
  return result;
}

ok('every registered drawing tool reuses its existing hit geometry', () => {
  for (const type of Object.keys(TOOLS).filter((t) => t !== 'cursor')) {
    const l = layer(); l.items = [drawing(type, type, 100, 300)];
    const p = type === 'vline' ? [100,400] : type === 'avwap' ? [200,1000-1550/3]
      : ['text','arrowUp','arrowDown'].includes(type) ? [100,300]
        : ['hline','hray','fib','channel'].includes(type) ? [200,300] : [200,400];
    assert.equal(l.eraseAt(...p), type, type);
    assert.equal(l.items.length, 0, type);
  }
});

ok('one hit removes only the visually topmost eligible object, preserving normal selection hit testing', () => {
  const l = layer();
  l.items = [drawing('lower','hline',100,300), drawing('upper','hline',100,304)];
  assert.equal(l.hitTest(200,300), 'lower', 'ordinary selection still prefers the closest line');
  assert.equal(l.eraseAt(200,300), 'upper', 'eraser prefers the last drawn matching object');
  assert.deepEqual(l.items.map(d=>d.id), ['lower']);
});

ok('locked and hidden metadata are skipped, including above another eligible drawing', () => {
  const l = layer(); l.items = [drawing('free'), {...drawing('locked'),locked:true}, {...drawing('hidden'),hidden:true}];
  assert.equal(l.eraseAt(200,400), 'free');
  assert.equal(l.eraseAt(200,400), null);
  assert.deepEqual(l.items.map(d=>d.id), ['locked','hidden']);
});

ok('empty space does not save, change selection or delete unrelated objects', () => {
  const l = layer(); l.items = [drawing('keep')]; l.select('keep');
  l._changed = () => { throw new Error('Unexpected save'); };
  assert.equal(l.eraseAt(700,700), null);
  assert.equal(l.selectedId,'keep');
  assert.equal(l.items.length,1);
});

ok('erasing preserves another selected object and clears selection only when that object is removed', () => {
  const l = layer(); l.items = [drawing('a'),drawing('b','vline',400)]; l.select('b');
  assert.equal(l.eraseAt(200,400),'a'); assert.equal(l.selectedId,'b');
  assert.equal(l.eraseAt(400,400),'b'); assert.equal(l.selectedId,null);
  assert.equal(l.deleteSelected(),false);
});

ok('the existing Delete action and eraser share removal and immediate per-symbol persistence', () => {
  const saved = new Map();
  globalThis.localStorage = { getItem: k=>saved.get(k)??null, setItem:(k,v)=>saved.set(k,v) };
  const l=layer(); l.items=[drawing('a'),drawing('b','vline',400)]; l.select('a');
  assert.equal(l.deleteSelected(),true);
  assert.deepEqual(JSON.parse(saved.get('wickline.drawings.ERASER-UNIT')).map(d=>d.id),['b']);
  l.eraseAt(400,400);
  assert.deepEqual(layer().items,[]);
  delete globalThis.localStorage;
});

ok('Delete still clears a stale selection without removing an unrelated drawing', () => {
  const l=layer();l.items=[drawing('keep')];l.select('stale');
  assert.equal(l.deleteSelected(),true);assert.equal(l.selectedId,null);assert.equal(l.items[0].id,'keep');
});

ok('a fast segment erases separate thin lines between the observed mouse positions', () => {
  const l=layer(); l.items=[100,203,399,602].map(x=>drawing(String(x),'vline',x));
  const seen=new Set();
  assert.deepEqual(eraseAlong(l,{x:20,y:400},{x:720,y:400},seen),['100','203','399','602']);
  assert.equal(seen.size,4); assert.equal(l.items.length,0);
});

ok('sweeps cannot skip subpixel or zero-width boxes, without changing ordinary selection geometry', () => {
  for(const type of ['rect','measure'])for(const width of [0,.5,1]){
    const l=layer();const d=drawing('thin',type,101,300);d.p2=point(101+width,500);l.items=[d];
    assert.equal(l.hitTest(100,400),null,'normal selection still requires a point inside the box');
    assert.deepEqual(eraseAlong(l,{x:80,y:400},{x:120,y:400},new Set()),['thin']);
  }
});

ok('stationary movement/release does not erase another overlapping object or repeat a deletion', () => {
  const l=layer(); l.items=[drawing('a'),drawing('b')]; const seen=new Set();
  assert.deepEqual(eraseAlong(l,null,{x:200,y:400},seen),['b']);
  assert.deepEqual(eraseAlong(l,{x:200,y:400},{x:200,y:400},seen),[]);
  l.items.push(drawing('b'));
  assert.equal(l.eraseAt(200,400,seen),'a');
  assert.equal(l.eraseAt(200,400,seen),null);
});

ok('invalid path coordinates are ignored', () => {
  const l=layer(); l.items=[drawing('keep')];
  assert.deepEqual(eraseAlong(l,null,{x:Infinity,y:400},new Set()),[]);
  assert.equal(l.items.length,1);
});

function gesture() {
  const win=new EventTarget(), doc=new EventTarget(), root=new EventTarget();
  win.innerWidth=1600;win.innerHeight=900;
  doc.defaultView=win; root.ownerDocument=doc;
  const classes=new Set(); root.classList={add:k=>classes.add(k),remove:k=>classes.delete(k)};
  root.setPointerCapture=()=>{}; root.releasePointerCapture=()=>{};
  const a=layer(),b=layer(),hosts=[{style:{cursor:'crosshair'}},{style:{cursor:'ns-resize'}}];
  b.key='OTHER';
  const controller=new MiddleMouseEraser(root,e=>{
    if(e.clientX<0||e.clientX>1600||e.clientY>800)return null;
    const second=e.clientX>=800, x=e.clientX-(second?800:0);
    return {layer:second?b:a,host:hosts[second?1:0],point:e.clientY<0?null:{x,y:e.clientY}};
  });
  const fire=(target,type,values={})=>{
    const event=new Event(type,{cancelable:true});
    Object.assign(event,{pointerId:7,pointerType:'mouse',button:1,buttons:4,clientX:200,clientY:400,...values});
    target.dispatchEvent(event);return event;
  };
  return {win,doc,root,a,b,hosts,controller,classes,fire};
}

ok('middle press erases without selecting a tool, freezes an unfinished preview and restores the cursor', () => {
  const g=gesture(); g.a.items=[drawing('erase')]; g.a.setTool('trend');
  g.a.handleClick({point:{x:50,y:100}}); const pending=JSON.stringify(g.a.pending);
  assert.equal(g.fire(g.root,'pointerdown').defaultPrevented,true);
  assert.equal(g.a.items.length,0); assert.equal(g.a.tool,'trend'); assert.equal(g.a.erasing,true);
  g.a.handleMove({point:{x:400,y:500}}); g.a.handleClick({point:{x:400,y:500}});
  assert.equal(JSON.stringify(g.a.pending),pending);
  g.hosts[0].style.cursor='changed-during-gesture'; g.fire(g.win,'pointerup',{buttons:0});
  assert.equal(g.a.erasing,false); assert.equal(g.hosts[0].style.cursor,'crosshair');
  assert.equal(g.a.tool,'trend'); assert.equal(g.classes.size,0); g.controller.destroy();
});

ok('cross-chart movement uses local coordinates and never interpolates between unrelated charts', () => {
  const g=gesture(); g.a.items=[drawing('left')]; g.b.items=[drawing('right'),drawing('keep','vline',600)];
  g.fire(g.root,'pointerdown'); g.fire(g.win,'pointermove',{clientX:1000});
  assert.equal(g.a.items.length,0); assert.deepEqual(g.b.items.map(d=>d.id),['keep']);
  g.fire(g.win,'pointerup',{clientX:1000,buttons:0}); g.controller.destroy();
});

ok('leaving the chart pauses interpolation instead of erasing a path across UI or outside space', () => {
  const g=gesture(); g.a.items=[drawing('keep','vline',400)];
  g.fire(g.root,'pointerdown');g.fire(g.win,'pointermove',{clientY:850});g.fire(g.win,'pointermove',{clientX:600});
  assert.equal(g.a.items.length,1);g.controller.destroy();
});

ok('captured coordinates outside the native window end erasing immediately', () => {
  const g=gesture();g.fire(g.root,'pointerdown');g.fire(g.win,'pointermove',{clientX:-1});
  assert.equal(g.controller.session,null);assert.equal(g.a.erasing,false);g.controller.destroy();
});

for (const type of ['blur','pointercancel','pointerout','pagehide','keydown']) ok(`${type} releases the temporary gesture`, () => {
  const g=gesture();g.fire(g.root,'pointerdown');g.fire(g.win,type,{relatedTarget:null,key:'Escape'});
  assert.equal(g.controller.session,null);assert.equal(g.a.erasing,false);assert.equal(g.classes.size,0);g.controller.destroy();
});

ok('modifier keys do not terminate a held eraser gesture', () => {
  const g=gesture();g.fire(g.root,'pointerdown');g.fire(g.win,'keydown',{key:'Shift'});
  assert.ok(g.controller.session);assert.equal(g.a.erasing,true);g.controller.destroy();
});

ok('lost capture, a missing middle-button bit and hidden-document state each clean up', () => {
  for(const mode of ['capture','buttons','hidden']){
    const g=gesture();g.fire(g.root,'pointerdown');
    if(mode==='capture')g.fire(g.root,'lostpointercapture');
    if(mode==='buttons')g.fire(g.win,'pointermove',{buttons:0});
    if(mode==='hidden'){g.doc.hidden=true;g.fire(g.doc,'visibilitychange');}
    assert.equal(g.a.erasing,false);assert.equal(g.controller.session,null);g.controller.destroy();
  }
});

ok('left, right, touch and middle operations outside charts retain their default behavior', () => {
  const g=gesture();g.a.items=[drawing('keep')];
  for(const values of [{button:0},{button:2},{pointerType:'touch'},{clientX:-1}])assert.equal(g.fire(g.root,'pointerdown',values).defaultPrevented,false);
  assert.equal(g.fire(g.root,'auxclick',{clientX:-1}).defaultPrevented,false);
  assert.equal(g.fire(g.root,'wheel').defaultPrevented,false);assert.equal(g.a.items.length,1);g.controller.destroy();
});

ok('axes suppress browser middle autoscroll but cannot begin an erase gesture', () => {
  const g=gesture();assert.equal(g.fire(g.root,'pointerdown',{clientY:-1}).defaultPrevented,true);
  assert.equal(g.controller.session,null);g.controller.destroy();
});

ok('symbol or series replacement ends a gesture before it can delete new-context drawings', () => {
  for(const change of ['key','series']){
    const g=gesture();g.fire(g.root,'pointerdown',{clientX:50});g.a.items=[drawing('keep')];
    g.a[change]=change==='key'?'NEW':{};g.fire(g.win,'pointermove');
    assert.equal(g.controller.session,null);assert.equal(g.a.items.length,1);g.controller.destroy();
  }
});

ok('a whole sweep is one undo step even across long pauses, with exact attributes and redo', () => {
  const l=layer();
  l.items=[{...drawing('a','vline',200),text:'keep label',width:3,lineStyle:'dashed'},drawing('b','vline',400)];
  l._changed(true);
  const before=JSON.stringify(l.items), now=Date.now;
  try {
    let clock=1e12;Date.now=()=>clock;
    l.beginErase();l.eraseAt(200,400);clock+=5000;l.eraseAt(400,400);l.endErase();
    assert.equal(l.items.length,0);assert.ok(l.undo());assert.equal(JSON.stringify(l.items),before);
    assert.ok(l.redo());assert.equal(l.items.length,0);
  } finally { Date.now=now; }
});

ok('separate clicks form separate undo steps, and an empty gesture does not clear redo', () => {
  const l=layer();l.items=[drawing('a'),drawing('b','vline',400)];l._changed(true);
  for(const x of [200,400]){l.beginErase();l.eraseAt(x,400);l.endErase();}
  assert.ok(l.undo());assert.deepEqual(l.items.map(d=>d.id),['b']);
  l.beginErase();l.eraseAt(700,700);l.endErase();
  assert.ok(l.redo());assert.equal(l.items.length,0);
  assert.ok(l.undo());assert.ok(l.undo());assert.deepEqual(l.items.map(d=>d.id),['a','b']);
});

ok('undoing an erase and redoing it each persist through the existing store', () => {
  const saved=new Map();
  globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
  try {
    const l=layer();l.items=[drawing('a')];l._changed(true);
    l.beginErase();l.eraseAt(200,400);l.endErase();
    assert.ok(l.undo());assert.equal(layer().items[0].id,'a');
    assert.ok(l.redo());assert.deepEqual(layer().items,[]);
  } finally { delete globalThis.localStorage; }
});

ok('cross-chart erasing makes an independent undo step in each visited chart', () => {
  const g=gesture();g.a.items=[drawing('a')];g.b.items=[drawing('b')];
  g.a._changed(true);g.b._changed(true);
  g.fire(g.root,'pointerdown');g.fire(g.win,'pointermove',{clientX:1000});g.fire(g.win,'pointerup',{clientX:1000});
  assert.ok(g.b.undo());assert.equal(g.a.items.length,0);assert.equal(g.b.items[0].id,'b');
  assert.ok(g.a.undo());assert.equal(g.a.items[0].id,'a');g.controller.destroy();
});

ok('releasing the middle button with another button still held ends the gesture on mouseup', () => {
  const g=gesture();g.fire(g.root,'pointerdown');
  g.fire(g.win,'mouseup',{pointerId:undefined,buttons:1});
  assert.equal(g.controller.session,null);assert.equal(g.a.erasing,false);g.controller.destroy();
});

ok('editing shortcuts finish the gesture before normal Escape, Delete and history handlers run', () => {
  for(const key of ['Escape','Delete','Backspace','z','y','d']){
    const g=gesture();g.a.setTool('trend');g.a.handleClick({point:{x:50,y:100}});
    const pending=JSON.stringify(g.a.pending);g.fire(g.root,'pointerdown');
    assert.equal(g.fire(g.win,'keydown',{key}).defaultPrevented,false);
    assert.equal(g.controller.session,null);assert.equal(g.a.erasing,false);
    assert.equal(JSON.stringify(g.a.pending),pending);g.controller.destroy();
  }
});

ok('active drawing drags cannot start erasing, and foreign pointer events cannot finish it', () => {
  const g=gesture();g.a.drag={};g.a.items=[drawing('keep')];
  g.fire(g.root,'pointerdown');assert.equal(g.controller.session,null);assert.equal(g.a.items.length,1);
  g.a.drag=null;g.fire(g.root,'pointerdown');g.fire(g.win,'pointercancel',{pointerId:99});
  g.fire(g.win,'pointerup',{pointerId:99});assert.ok(g.controller.session);g.controller.destroy();
});

const pane = {}, otherPane = {};
const timeScale = { coordinateToLogical: x=>x/100, timeToCoordinate: time=>time*100, options:()=>({barSpacing:100}) };
function indicator(id, { points=[100,200,100], options={}, type='Line', target=pane, order=0, hidden=false, offChart=false }={}) {
  const api = { options:()=>({visible:true,lineVisible:true,...options}),seriesType:()=>type,
    seriesOrder:()=>order,getPane:()=>({getHTMLElement:()=>target}),priceToCoordinate:p=>p,
    dataByIndex(i,direction=0){
      if(Number.isFinite(points[i]))return {time:i,value:points[i]};
      for(let j=i+direction;direction && j>=0 && j<points.length;j+=direction){if(Number.isFinite(points[j]))return {time:j,value:points[j]};}
      return null;
    } };
  return {inst:{id,hidden},offChart,series:[{api}]};
}

ok('indicator hit testing finds rendered line segments rather than whole pane or price ranges', () => {
  const entry=indicator('ema');
  assert.equal(hitIndicator([entry],timeScale,pane,50,150),'ema');
  assert.equal(hitIndicator([entry],timeScale,pane,50,180),null);
  assert.equal(hitIndicator([entry],timeScale,pane,350,200),null);
});

ok('indicator hits are limited to visible registered series in the correct pane', () => {
  for(const entry of [indicator('hidden',{hidden:true}),indicator('off',{offChart:true}),indicator('disabled',{options:{visible:false}}),indicator('other',{target:otherPane})]){
    assert.equal(hitIndicator([entry],timeScale,pane,50,150),null);
  }
  assert.equal(hitIndicator([],timeScale,pane,50,150),null);
});

ok('indicator overlap respects series z-order and skips already visited indicator IDs', () => {
  const entries=[indicator('top',{order:8}),indicator('bottom',{order:2})];
  assert.equal(hitIndicator(entries,timeScale,pane,50,150),'top');
  assert.equal(hitIndicator(entries,timeScale,pane,50,150,new Set(['indicator:top'])),'bottom');
});

ok('one multi-plot indicator is identified by any of its plots', () => {
  const entry=indicator('macd');entry.series.push(...indicator('unused',{points:[300,300,300]}).series);
  assert.equal(hitIndicator([entry],timeScale,pane,50,300),'macd');
});

ok('indicator histogram hits use bar width, value and base, not empty pane space', () => {
  const entry=indicator('volume',{type:'Histogram',points:[180,200,180],options:{base:300}});
  assert.equal(hitIndicator([entry],timeScale,pane,110,250),'volume');
  assert.equal(hitIndicator([entry],timeScale,pane,110,170),null);
  assert.equal(hitIndicator([entry],timeScale,pane,350,250),null);
});

ok('stepped plots and dot-only plots use their visible geometry', () => {
  const step=indicator('step',{options:{lineType:1}});
  assert.equal(hitIndicator([step],timeScale,pane,50,100),'step');
  assert.equal(hitIndicator([step],timeScale,pane,100,150),'step');
  assert.equal(hitIndicator([step],timeScale,pane,50,150),null);
  const dots=indicator('dots',{options:{lineVisible:false,pointMarkersVisible:true}});
  assert.equal(hitIndicator([dots],timeScale,pane,100,200),'dots');
  assert.equal(hitIndicator([dots],timeScale,pane,50,150),null);
});

ok('indicator level lines belong to their owning indicator and respect visibility', () => {
  const entry=indicator('rsi');let visible=true;
  entry.levelLines=[{options:()=>({price:70,lineVisible:visible})}];
  assert.equal(hitIndicator([entry],timeScale,pane,50,70),'rsi');
  visible=false;assert.equal(hitIndicator([entry],timeScale,pane,50,70),null);
});

ok('a sampled indicator sweep can collect several hits before a layout-changing removal', () => {
  const entries=[100,200,300].map((y,i)=>indicator(String(i),{points:[y,y,y]}));const seen=new Set(),queued=[];
  const removed=eraseAlong(null,{x:50,y:50},{x:50,y:350},seen,(x,y,visited)=>{
    const id=hitIndicator(entries,timeScale,pane,x,y,visited);if(id===null)return null;
    visited.add(`indicator:${id}`);queued.push(id);return `indicator:${id}`;
  });
  assert.deepEqual(queued,['0','1','2']);assert.equal(removed.length,3);
});

ok('changed pane scopes never interpolate, and stationary release cannot delete newly reflowed content', () => {
  const g=gesture();g.controller.destroy();let scope={},calls=0;
  const root=Object.assign(new EventTarget(),{ownerDocument:g.doc,classList:g.root.classList,setPointerCapture(){},releasePointerCapture(){}});
  const controller=new MiddleMouseEraser(root,e=>({layer:g.a,host:g.hosts[0],scope,point:{x:e.clientX,y:e.clientY},eraseAt(){calls++;scope={};return 'indicator:test'}}));
  g.fire(root,'pointerdown');g.fire(g.win,'pointerup',{buttons:0});
  assert.equal(calls,1);controller.destroy();
});

console.log(`middle mouse eraser: ${n} checks passed`);
