// Native Electron input; deterministic candles and a separate process for persistence checks.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const file=fileURLToPath(import.meta.url),wait=ms=>new Promise(r=>setTimeout(r,ms));
if(!process.versions.electron){
 const {createRequire}=await import('node:module'),{spawn}=await import('node:child_process'),{startServer}=await import('../server.mjs');
 const electron=createRequire(import.meta.url)('electron'),profile=mkdtempSync(path.join(os.tmpdir(),'wickline-shift-measure-'));
 const {server,port}=await startServer({port:0,host:'127.0.0.1'});
 try{for(const phase of ['exercise','restore']){
  const code=await new Promise((resolve,reject)=>{const child=spawn(electron,[file,phase],{windowsHide:true,stdio:'inherit',env:{...process.env,WICKLINE_MEASURE_PROFILE:profile,WICKLINE_MEASURE_ORIGIN:`http://127.0.0.1:${port}`}});
   const timer=setTimeout(()=>{child.kill();reject(Error(`${phase} timed out`))},120000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('exit',code=>{clearTimeout(timer);resolve(code)})});assert.equal(code,0,`${phase} failed`);
 }}catch(e){console.error(e);process.exitCode=1}finally{server.closeAllConnections();server.close()}
}else{
 const {app,BrowserWindow,session}=await import('electron'),profile=process.env.WICKLINE_MEASURE_PROFILE;
 app.setPath('userData',profile);app.commandLine.appendSwitch('lang','en-US');app.on('window-all-closed',()=>{});
 app.whenReady().then(async()=>{
  const origin=process.env.WICKLINE_MEASURE_ORIGIN;session.defaultSession.webRequest.onBeforeRequest((d,cb)=>{const u=new URL(d.url);cb({cancel:u.origin!==origin||(u.pathname.startsWith('/api/')&&u.pathname!=='/api/health')})});
  const win=new BrowserWindow({width:1400,height:900,show:false,webPreferences:{backgroundThrottling:false}}),errors=[];
  win.webContents.on('console-message',e=>{if(e.level==='error'&&!/Failed to load resource|ERR_ABORTED/.test(e.message))errors.push(e.message)});
  const run=s=>win.webContents.executeJavaScript(s);let passed=0,failed=0,held=false,shift=false;
  const check=(name,value,detail='')=>{value?passed++:failed++;console.log(`  ${value?'ok  ':'FAIL'} ${name}${detail?' - '+detail:''}`)};
  const until=async s=>{for(let i=0;i<150;i++){if(await run(s))return;await wait(40)}throw Error('Timed out: '+s)};
  const frame=async()=>{for(let i=0;;i++){try{return await win.webContents.capturePage()}catch(e){if(i===4||!/UnknownVizError/.test(String(e)))throw e;await wait(80)}}};
  const key=async(k,mods=[])=>{for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:k,modifiers:mods});await wait(40)};
  const setShift=on=>{shift=on;win.webContents.sendInputEvent({type:on?'keyDown':'keyUp',keyCode:'Shift',modifiers:on?['shift']:[]})};
  const mouse=(type,p,button='left')=>{if(type==='mouseDown')held=true;if(type==='mouseUp')held=false;win.webContents.sendInputEvent({type,x:Math.round(p.x),y:Math.round(p.y),...(button==='none'?{}:{button}),modifiers:[...(shift?['shift']:[]),...(held?['leftbuttondown']:[])],clickCount:1})};
  const click=async(p,button='left')=>{mouse('mouseMove',p,'none');mouse('mouseDown',p,button);mouse('mouseUp',p,button);await wait(60)};
  const point=(index,price,i=0)=>run(`(()=>{const v=window.__wickline.views()[${i}],r=v.chartEl.getBoundingClientRect(),p=v.chart.panes()[0].getHTMLElement().getBoundingClientRect();return{x:r.left+v.chart.timeScale().logicalToCoordinate(${index}),y:p.top+v.main.priceToCoordinate(${price})}})()`);
  const at=(x,y,i=0)=>run(`(()=>{const v=window.__wickline.views()[${i}],r=v.chartEl.getBoundingClientRect(),p=v.chart.panes()[0].getHTMLElement().getBoundingClientRect();return{x:r.left+${x},y:p.top+${y}}})()`);
  const prepare=()=>run(`(()=>{for(const v of window.__wickline.views()){v.loadGen++;v.feed?.close();v.feed={close(){},canLoadMore:false};v.bars=Array.from({length:220},(_,i)=>({time:1700000000+i*v.tf.sec,open:2000+i*5,high:2030+i*5,low:1980+i*5,close:2010+i*5,volume:1000+i}));v.meta={precision:2,tzOffset:0};v.renderAll(true);v.showError(null);v.q('.overlay.loading').hidden=true;v.drawings.setContext(v.state.symbol,v.tf.sec)}})()`);
  const measure=async(a,b,complete=true)=>{setShift(true);mouse('mouseMove',a,'none');await frame();mouse('mouseDown',a);mouse('mouseUp',a);setShift(false);await wait(40);
   for(let i=1;i<=4;i++){mouse('mouseMove',{x:a.x+(b.x-a.x)*i/4,y:a.y+(b.y-a.y)*i/4},'none');await frame()}
   if(complete)await click(b)};
  const state=(i=0)=>run(`(()=>{const v=window.__wickline.views()[${i}],l=v.drawings;return{measurement:l.measurement,measuring:l.measuring,active:!!v.shiftMeasure.session,captured:!!v.shiftMeasure.session?.captured,cursor:getComputedStyle(v.chartEl).cursor,items:l.items,selected:l.selectedId,tool:l.tool}})()`);
  const stats=(i=0)=>run(`import('./js/measurement.js').then(m=>{const l=window.__wickline.views()[${i}].drawings;return l.measurement&&{...m.measurementStats(l.measurement.p1,l.measurement.p2,t=>l.logicalFromTime(t),.01),text:m.measurementText(m.measurementStats(l.measurement.p1,l.measurement.p2,t=>l.logicalFromTime(t),.01),l.formatPrice)}})`);
  const shots=process.env.WICKLINE_MEASURE_SHOTS;
  const shot=async name=>{if(shots){mkdirSync(shots,{recursive:true});writeFileSync(path.join(shots,name+'.png'),(await frame()).toPNG())}};
  try{
   const restoring=process.argv.at(-1)==='restore';await win.loadURL(`${origin}/?e2e${restoring?'':'#s=YAHOO:AAPL&tf=1h'}`);await until('!!window.__wickline?.views().length');await prepare();await wait(200);await frame();win.webContents.focus();
   if(restoring){
    const expected=JSON.parse(readFileSync(path.join(profile,'expected.json'),'utf8'));
    check('a real process restart preserves normal drawings and their properties',JSON.stringify(await run(`window.__wickline.views().map(v=>v.drawings.items)`))===JSON.stringify(expected));
    check('temporary measurement and capture never return after restart',await run(`window.__wickline.views().every(v=>!v.drawings.measurement&&!v.drawings.measuring&&!v.shiftMeasure.session)`));
    await run(`window.__wickline.views()[0].chart.timeScale().setVisibleLogicalRange({from:60,to:150})`);await frame();await wait(100);
    await measure(await point(90,2450),await point(122,2632));const chinese=await stats();
    check('Simplified Chinese readout includes combined days and hours',await run(`document.documentElement.lang==='zh-CN'`)&&chinese?.bars===32&&chinese.text.includes('1 天 8 小时'),JSON.stringify(chinese));await shot('zh-CN-up');
   }else{
    await run(`window.addEventListener('pointerdown',e=>window.__measurePointer=e.pointerId,true);(()=>{const l=window.__wickline.views()[0].drawings;l.items=[{id:'keep',type:'hline',color:'#4FA3F7',p1:{time:l.bars[80].time,price:2800},p2:{time:l.bars[80].time,price:2800},label:'saved'}];l.select('keep');l._changed(true)})()`);
    await wait(200);mouse('mouseMove',await point(90,2450),'none');await frame();await wait(100);const saved=await run(`localStorage.getItem('wickline.drawings.YAHOO:AAPL')`),history=await run(`JSON.stringify([...window.__wickline.views()[0].drawings._histories])`),range=await run(`JSON.stringify(window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange())`);
    let a=await point(90,2450),b=await point(122,2632.39);await measure(a,b,false);
    const active=await state();check('Shift-click anchors and free movement continues after releasing Shift and the mouse',active.measuring&&active.active&&!active.captured&&active.cursor==='crosshair'&&!held&&!shift);
    const preview=JSON.stringify(active.measurement);await click(b);await wait(80);const first=await state(),numbers=await stats();
    check('a plain second click fixes the endpoint and restores tool state',!!first.measurement&&!first.measuring&&!first.active&&!first.captured&&first.tool==='cursor');
    mouse('mouseMove',await point(140,2700),'none');await frame();
    check('the fixed measurement no longer follows the pointer after the second click',JSON.stringify((await state()).measurement)===JSON.stringify(first.measurement));
    check('32 hourly intervals display a combined 1 day 8 hour duration',numbers.bars===32&&numbers.seconds===115200&&numbers.text.includes('1d 8h'),numbers.text);
    check('price delta, percentage and tick values follow the measured price coordinates',Math.abs(numbers.delta-(first.measurement.p2.price-first.measurement.p1.price))<1e-8&&Math.abs(numbers.percent-numbers.delta/first.measurement.p1.price*100)<1e-8&&numbers.ticks===Math.round(numbers.delta/.01));
    check('measuring does not pan the chart or modify selection',range===await run(`JSON.stringify(window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange())`)&&first.selected==='keep',JSON.stringify({before:JSON.parse(range),after:await run(`window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange()`),selected:first.selected}));
    check('measurement never saves drawings or adds an undo step',saved===await run(`localStorage.getItem('wickline.drawings.YAHOO:AAPL')`)&&history===await run(`JSON.stringify([...window.__wickline.views()[0].drawings._histories])`));
    await shot('dark-up');await key('Escape');check('Escape clears only the measurement, retaining the selected drawing',!(await state()).measurement&&(await state()).selected==='keep');
    a=await point(132,2700);b=await point(100,2500);await measure(a,b);const down=await stats();check('reverse dragging reports a fall with positive bar count and duration',down.delta<0&&down.percent<0&&down.bars===32&&down.seconds===115200);await shot('dark-down');
    await click(await at(40,200));check('the next ordinary click dismisses the temporary readout',!(await state()).measurement);
    a=await point(110,2550);b=await point(110,2650);await measure(a,b);const vertical=await stats();check('vertical same-bar measurement shows zero bars without NaN',vertical.bars===0&&vertical.seconds===0&&!/NaN|Infinity/.test(vertical.text));await key('Escape');
    a=await point(100,2500);b=await point(132,2500);await measure(a,b);check('horizontal measurement reports zero price change',Math.abs((await stats()).delta)<1e-8);await key('Escape');
    await run(`document.querySelector('#theme-btn').click()`);await measure(await point(90,2450),await point(122,2632));await shot('light-up');check('light theme renders and retains the same temporary measurement',await run(`document.documentElement.dataset.theme==='light'&&!!window.__wickline.views()[0].drawings.measurement`));await key('Escape');
    a=await at(200,250);b=await at(430,200);setShift(true);mouse('mouseMove',a,'none');mouse('mouseDown',a);setShift(false);await wait(60);
    check('releasing Shift before the first mouse release does not end measurement',(await state()).active&&(await state()).measuring);
    mouse('mouseUp',a);mouse('mouseMove',b,'none');await frame();const shifted=await state();
    check('zero-button movement still updates the pending endpoint after both releases',shifted.active&&shifted.measuring&&!shifted.captured&&shifted.measurement.p1.time!==shifted.measurement.p2.time);
    await click(b);await key('Escape');
    await key('T',['alt']);await click(await at(180,250));const pending=await run(`window.__wickline.views()[0].drawings.pending?.id`);setShift(true);await click(await at(380,210));setShift(false);
    check('Shift still creates a horizontal trend line with the drawing tool',await run(`(()=>{const l=window.__wickline.views()[0].drawings,d=l.items.find(d=>d.id===${JSON.stringify(pending)});return !!d&&d.p1.price===d.p2.price&&!l.measurement})()`));
    const handle=await run(`(()=>{const v=window.__wickline.views()[0],l=v.drawings,d=l.selected,r=v.chartEl.getBoundingClientRect(),p=v.chart.panes()[0].getHTMLElement().getBoundingClientRect();return{x:r.left+l._x(d.p2.time),y:p.top+l._y(d.p2.price)}})()`);
    setShift(true);mouse('mouseMove',handle,'none');mouse('mouseDown',handle);mouse('mouseMove',{x:handle.x+60,y:handle.y+70});await frame();mouse('mouseUp',{x:handle.x+60,y:handle.y+70});setShift(false);await wait(60);
    check('selected-handle Shift dragging retains its existing horizontal constraint',await run(`(()=>{const l=window.__wickline.views()[0].drawings,d=l.selected;return !!d&&d.p1.price===d.p2.price&&!l.measurement})()`));
    await run(`window.__wickline.views()[0].drawings.select(null)`);setShift(true);await click(await point(85,2800));setShift(false);
    check('Shift-click on an existing drawing retains its original selection behavior',(await state()).selected==='keep'&&!(await state()).measurement);
    await run(`(()=>{const v=window.__wickline.views()[0];window.__oldPaperHook=v.hooks.onPaperDrag;v.hooks.onPaperDrag=(v,id,price)=>window.__paperMeasureHit={id,price};v.setPaperLines([{id:'measure-order',price:2700,color:'#FF9800',style:'solid',title:'test',drag:true}])})()`);
    const paper=await point(120,2700);setShift(true);mouse('mouseMove',paper,'none');mouse('mouseDown',paper);mouse('mouseMove',{x:paper.x,y:paper.y+50});await frame();mouse('mouseUp',{x:paper.x,y:paper.y+50});setShift(false);await wait(60);
    check('Shift dragging a paper order line uses the existing order drag rather than measurement',await run(`window.__paperMeasureHit?.id==='measure-order'&&window.__paperMeasureHit.price!==2700&&!window.__wickline.views()[0].drawings.measurement`));
    await run(`(()=>{const v=window.__wickline.views()[0];v.setPaperLines([]);v.hooks.onPaperDrag=window.__oldPaperHook})()`);
    const axis=await run(`(()=>{const r=window.__wickline.views()[0].chartEl.getBoundingClientRect();return{x:r.right-12,y:r.top+170}})()`);setShift(true);await click(axis);setShift(false);check('Shift on the price axis does not start measurement',!(await state()).measurement);
    const sub=await run(`(()=>{const p=window.__wickline.views()[0].chart.panes()[1].getHTMLElement().getBoundingClientRect();return{x:p.left+100,y:p.top+30}})()`);setShift(true);await click(sub);setShift(false);check('indicator panes do not measure using the main price scale',!(await state()).measurement);
    await run(`window.__wickline.views()[0].drawings.select(null)`);a=await at(200,180);b=await at(440,240);await measure(a,b,false);await run(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__measurePointer}))`);mouse('mouseUp',b);setShift(false);check('pointercancel cleans up temporary state',!(await state()).measurement&&!(await state()).active&&!(await state()).captured);
    setShift(true);mouse('mouseMove',a,'none');mouse('mouseDown',a);await run(`window.__wickline.views()[0].chartEl.releasePointerCapture(window.__measurePointer)`);mouse('mouseMove',{x:a.x+2,y:a.y});mouse('mouseUp',a);setShift(false);await wait(50);check('unexpected capture loss during the anchor press cancels safely',!(await state()).active&&!(await state()).active&&!(await state()).captured&&!(await state()).measuring);
    await measure(a,b,false);mouse('mouseMove',{x:-20,y:-20});mouse('mouseLeave',{x:-20,y:-20},'none');await wait(40);mouse('mouseUp',b);setShift(false);check('leaving the native window cancels the active measurement',!(await state()).measurement&&!(await state()).active&&!(await state()).captured);
    win.setSkipTaskbar(true);win.setPosition(-10000,-10000);win.show();win.focus();
    for(let i=0;i<80&&!win.isFocused();i++)await wait(40);
    await until('document.hasFocus()');await measure(a,b,false);
    const other=new BrowserWindow({show:false,skipTaskbar:true,x:-10000,y:-10000});await other.loadURL('about:blank');other.show();other.focus();
    for(let i=0;i<80&&(!other.isFocused()||win.isFocused());i++)await wait(40);
    await wait(100);const focusState=await state();
    check('real native focus loss clears the measurement and capture',!win.isFocused()&&other.isFocused()&&!focusState.measurement&&!focusState.active&&!focusState.captured,JSON.stringify({sourceFocused:win.isFocused(),otherFocused:other.isFocused(),measurement:!!focusState.measurement,active:focusState.active,captured:focusState.captured}));other.destroy();win.hide();win.webContents.focus();mouse('mouseUp',b);setShift(false);
    await prepare();await wait(120);await measure(await at(200,240),await at(430,190));const wheel=await at(500,230),span=()=>run(`(()=>{const r=window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange();return r.to-r.from})()`),beforeSpan=await span();
    win.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(wheel.x),y:Math.round(wheel.y),deltaY:-120,deltaX:0,canScroll:true});await wait(250);check('ordinary wheel zoom still works with a retained measurement',Math.abs(await span()-beforeSpan)>1);
    await key('Escape');await run(`window.__wickline.views()[0].drawings.items=[];window.__wickline.views()[0].drawings.select(null)`);const pan=await at(500,250),oldRange=await run(`JSON.stringify(window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange())`);
    mouse('mouseMove',pan,'none');mouse('mouseDown',pan);for(let i=1;i<=8;i++){mouse('mouseMove',{x:pan.x+i*10,y:pan.y});await frame();await wait(20)}mouse('mouseUp',{x:pan.x+80,y:pan.y});await wait(120);check('ordinary left panning resumes after measurement',oldRange!==await run(`JSON.stringify(window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange())`));
    mouse('mouseMove',await at(400,200),'none');await wait(50);check('normal crosshair updates resume after measurement',await run(`!!window.__wickline.views()[0].lastCrosshair?.point`));
    await run(`document.querySelector('#layout-menu [data-layout="2v"]').click()`);await until('window.__wickline.views().length===2');await prepare();await wait(150);a=await at(150,180);b=await at(200,230,1);await measure(a,b,false);check('free cross-chart movement previews only in the original chart',(await state()).active&&!!(await state()).measurement&&!(await state(1)).measurement);await shot('multi-chart');
    await click(b);check('clicking another chart cancels rather than committing on the wrong chart',!(await state()).measurement&&!(await state(1)).measurement);
    await measure(await at(120,180),await at(260,230));await run(`window.__wickline.views()[0].setTimeframe('4h')`);check('timeframe replacement clears a retained measurement immediately',!(await state()).measurement);await prepare();await wait(100);
    await measure(await at(120,180),await at(260,230));await run(`window.__wickline.views()[0].setChartType('line')`);check('series replacement clears temporary measurement state',!(await state()).measurement);await prepare();
    await measure(await at(120,180),await at(260,230));await run(`window.__wickline.views()[0].setSymbol('YAHOO:MSFT')`);check('symbol changes discard the old measurement',!(await state()).measurement);await prepare();await wait(100);
    await run(`(()=>{for(const [i,v]of window.__wickline.views().entries()){const l=v.drawings;l.items=[{id:'survivor-'+i,type:'hline',color:'#4FA3F7',p1:{time:v.bars[80].time,price:2500},p2:{time:v.bars[80].time,price:2500}}];l.select(null);l._changed(true)}})()`);
    await measure(await at(120,180),await at(260,230));await until(`!!localStorage.getItem('wickline.workspace')`);await wait(250);
    check('measurement does not become a saved drawing or workspace field',await run(`window.__wickline.views().every(v=>v.drawings.items.length===1&&JSON.parse(localStorage.getItem('wickline.drawings.'+v.state.symbol)).length===1)&&!localStorage.getItem('wickline.workspace').includes('measurement')`));
    await run(`window.__wickline.views()[0].setTimeframe('1h')`);await prepare();await wait(150);await frame();
    await measure(await at(120,180),await at(260,230));await wait(250);
    await run(`localStorage.setItem('wickline.lang','"zh-CN"')`);
    writeFileSync(path.join(profile,'expected.json'),JSON.stringify(await run(`window.__wickline.views().map(v=>v.drawings.items)`)));
   }
   check('no renderer application errors',errors.length===0,errors.join('; '));session.defaultSession.flushStorageData();await session.defaultSession.cookies.flushStore();
   console.log(`shift measurement Electron ${process.argv.at(-1)}: ${passed} passed, ${failed} failed`);win.destroy();app.exit(failed?1:0);
  }catch(e){console.error(e);if(errors.length)console.error(errors.join('\n'));win.destroy();app.exit(1)}
 }).catch(e=>{console.error(e);app.exit(1)});
}
