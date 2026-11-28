// Real Electron mouse input and cross-process drawing persistence; all market data is deterministic.
// Run: npm run test:e2e:eraser. No third-party test runner is needed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(import.meta.url);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
if (!process.versions.electron) {
  const { createRequire } = await import('node:module');
  const { spawn } = await import('node:child_process');
  const { startServer } = await import('../server.mjs');
  const electron = createRequire(import.meta.url)('electron');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'wickline-eraser-'));
  const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
  try {
    for (const phase of ['exercise', 'restore']) {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(electron, [file, phase], { windowsHide: true, stdio: 'inherit',
          env: { ...process.env, WICKLINE_ERASER_PROFILE: profile, WICKLINE_ERASER_ORIGIN: `http://127.0.0.1:${port}` } });
        const timer = setTimeout(() => { child.kill(); reject(new Error(`${phase} timed out`)); }, 120000);
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
      });
      assert.equal(code, 0, `${phase} failed`);
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.closeAllConnections(); server.close(); }
} else {
  const { app, BrowserWindow, session } = await import('electron');
  const profile = process.env.WICKLINE_ERASER_PROFILE;
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('lang', 'en-US');
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    const origin = process.env.WICKLINE_ERASER_ORIGIN;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      callback({ cancel: url.origin !== origin || (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') });
    });
    const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' && !/Failed to load resource|ERR_ABORTED/.test(event.message)) errors.push(event.message);
    });
    let passed = 0, failed = 0;
    const check = (name, ok, detail = '') => {
      if (ok) passed++; else failed++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
    };
    const run = (code) => win.webContents.executeJavaScript(code);
    const frame = async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await win.webContents.capturePage(); }
        catch (error) { if (!/UnknownVizError/.test(String(error)) || attempt === 4) throw error; await wait(80); }
      }
    };
    const until = async (code) => {
      for (let i = 0; i < 150; i++) { if (await run(code)) return; await wait(40); }
      throw new Error(`Timed out: ${code}`);
    };
    let held = null;
    const mouse = (type, p, button = 'middle') => {
      if (type === 'mouseDown') held = button;
      if (type === 'mouseUp') held = null;
      win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y),
        ...(button === 'none' ? {} : { button }), modifiers: held ? [`${held}buttondown`] : [], clickCount: 1 });
    };
    const click = async (p, button = 'middle') => { mouse('mouseMove', p, 'none'); mouse('mouseDown', p, button); mouse('mouseUp', p, button); await wait(60); };
    const key = async (keyCode, modifiers = []) => {
      for (const type of ['keyDown','keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
      await wait(40);
    };
    const at = (x, y, view = 0) => run(`(() => {const r=window.__wickline.views()[${view}].chartEl.getBoundingClientRect();const pane=window.__wickline.views()[${view}].chart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:r.left+${x},y:pane.top+${y}};})()`);
    const anchor = (id, view = 0) => run(`(() => {const v=window.__wickline.views()[${view}],d=v.drawings.items.find(d=>d.id===${JSON.stringify(id)}),r=v.chartEl.getBoundingClientRect(),p=v.chart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:r.left+v.drawings._x(d.p1.time),y:p.top+180};})()`);
    const ids = (view = 0) => run(`window.__wickline.views()[${view}].drawings.items.map(d=>d.id)`);
    const idle = () => run(`!document.querySelector('#charts').classList.contains('middle-erasing') && window.__wickline.views().every(v=>!v.drawings.erasing)`);
    const fixture = (items, view = 0) => run(`window.__eraserFixture(${view},${JSON.stringify(items)})`);
    const prepare = () => run(`(() => {
      for (const v of window.__wickline.views()) {
        v.loadGen++;v.feed?.close();v.feed={close(){},canLoadMore:false};
        v.bars=Array.from({length:220},(_,i)=>({time:1700000000+i*86400,open:100+i*.2,high:105+i*.2,low:97+i*.2,close:102+i*.2,volume:1000}));
        v.meta={precision:2,tzOffset:0};v.renderAll(true);v.showError(null);v.q('.overlay.loading').hidden=true;
        v.drawings.setContext(v.state.symbol,v.tf.sec);
      }
      window.__eraserFixture=(index,items)=>{
        const v=window.__wickline.views()[index],l=v.drawings;
        l.items=items.map(({id,type='vline',x=200,y=180,locked,hidden})=>{
          const p=(a,b)=>{const r=l._point(a,b,true);return {time:r.time,price:r.price}};
          return {id,type,color:'#4FA3F7',p1:p(x,y),p2:p(x+120,y+60),p3:p(x,y-60),...(locked?{locked:true}:{}),...(hidden?{hidden:true}:{})};
        });
        l.select(null);l._changed(true);
      };
    })()`);
    try {
      const restoring = process.argv.at(-1) === 'restore';
      await win.loadURL(`${origin}/?e2e${restoring ? '' : '#s=YAHOO:AAPL&tf=1D'}`);
      await until(`!!window.__wickline?.views().length && !!document.querySelector('#toolbar [data-tool]')`);
      await prepare();
      if (!restoring) await run(`window.__wickline.views().forEach(v=>v.setAllIndicatorsHidden(true))`);
      await wait(150); await frame(); win.webContents.focus();
      if (process.argv.at(-1) === 'restore') {
        const expected = JSON.parse(readFileSync(path.join(profile,'eraser-expected.json'),'utf8'));
        check('new Electron process restores the remaining drawings with all properties', JSON.stringify(await run(`window.__wickline.views().map(v=>v.drawings.items)`))===JSON.stringify(expected));
        check('erased drawings stay absent after a real process restart', !(await run(`window.__wickline.views().flatMap(v=>v.drawings.items.map(d=>d.id))`)).some(id=>id.startsWith('deleted-')));
        check('temporary erasing state is never restored from storage', await idle());
        const indicators=JSON.parse(readFileSync(path.join(profile,'eraser-indicators-expected.json'),'utf8'));
        check('deleted indicators remain absent after a real process restart', JSON.stringify(await run(`window.__wickline.views().map(v=>v.state.indicators)`))===JSON.stringify(indicators));
      } else {
        await run(`window.__middleDefault=[];for(const type of ['pointerdown','mousedown','auxclick'])window.addEventListener(type,e=>{if(e.button===1){window.__middlePointer=e.pointerId??window.__middlePointer;setTimeout(()=>window.__middleDefault.push({type,prevented:e.defaultPrevented,inChart:!!e.target.closest?.('.chart-host')}),0)}},true)`);
        await fixture([{id:'single'}]); const single=await anchor('single'); await click(single);
        check('a native middle click deletes an unselected manual drawing', (await ids()).length===0);
        check('middle press/auxclick suppress chart autoscroll and leave no temporary state', await idle() && await run(`window.__middleDefault.filter(e=>e.inChart).every(e=>e.prevented)`));
        await fixture([{id:'keep'}]);await click(await at(700,250));
        check('middle clicking empty chart space leaves drawings unchanged', (await ids()).join()==='keep');
        await fixture([{id:'lower',type:'hline'},{id:'upper',type:'hline'}]);await click(await at(400,180));
        check('a stationary middle click removes only the topmost overlapping object', (await ids()).join()==='lower');

        await fixture([120,280,470,650].map(x=>({id:`fast-${x}`,x})));
        await run(`(() => {window.__deleteCalls=[];const l=window.__wickline.views()[0].drawings,remove=l.remove.bind(l);l.remove=(...args)=>{const done=remove(...args);if(done)window.__deleteCalls.push(args[0]);return done};})()`);
        const from=await at(40,180),to=await at(730,180);
        mouse('mouseMove',from,'none');mouse('mouseDown',from);mouse('mouseMove',to);mouse('mouseUp',to);await wait(80);
        check('a fast native move erases objects between event endpoints', (await ids()).length===0);
        check('each drawing is removed only once during a sweep', await run(`window.__deleteCalls.length===4 && new Set(window.__deleteCalls).size===4`));
        await fixture([{id:'thin-box',type:'rect',x:203,y:150}]);
        await run(`(()=>{const v=window.__wickline.views()[0],d=v.drawings.items[0];d.p2.time=d.p1.time+v.tf.sec*.05;d.p2.price=v.drawings._point(203,240,true).price;v.drawings._changed(true)})()`);
        mouse('mouseMove',from,'none');mouse('mouseDown',from);mouse('mouseMove',to);mouse('mouseUp',to);await wait(60);
        check('a fast native sweep also catches a subpixel-width rectangle', (await ids()).length===0);
        await fixture([{id:'locked',x:160,locked:true},{id:'hidden',x:350,hidden:true},{id:'free',x:550}]);
        mouse('mouseMove',from,'none');mouse('mouseDown',from);mouse('mouseMove',to);mouse('mouseUp',to);await wait(60);
        check('locked and hidden metadata are protected in a real sweep', (await ids()).join()==='locked,hidden');

        await fixture([{id:'undo-single',x:200}]);
        await run(`Object.assign(window.__wickline.views()[0].drawings.items[0],{text:'Original label',width:3,lineStyle:'dashed'});window.__wickline.views()[0].drawings._changed(true)`);
        const singleBefore=await run(`JSON.stringify(window.__wickline.views()[0].drawings.items)`);
        await click(await anchor('undo-single'));await key('Z',['control']);
        check('Ctrl+Z restores a middle-click deletion with exact drawing attributes', await run(`JSON.stringify(window.__wickline.views()[0].drawings.items)===${JSON.stringify(singleBefore)}`));
        await key('Y',['control']);
        check('Ctrl+Y redoes a middle-click deletion', (await ids()).length===0);
        await key('Z',['control']);await key('Z',['control','shift']);
        check('Ctrl+Shift+Z also redoes the deletion', (await ids()).length===0);
        await fixture([180,400,600].map(x=>({id:`undo-sweep-${x}`,x})));
        const sweepBefore=await run(`JSON.stringify(window.__wickline.views()[0].drawings.items)`);
        mouse('mouseMove',from,'none');mouse('mouseDown',from);mouse('mouseMove',await at(300,180));
        await wait(1250);mouse('mouseMove',to);mouse('mouseUp',to);await wait(60);
        check('a paused native sweep deletes every crossed drawing', (await ids()).length===0);
        await key('Z',['control']);
        check('one Ctrl+Z restores the entire sweep despite a pause longer than edit coalescing', await run(`JSON.stringify(window.__wickline.views()[0].drawings.items)===${JSON.stringify(sweepBefore)}`));
        await key('Y',['control']);
        check('one redo erases the entire sweep again', (await ids()).length===0);

        await fixture([{id:'old',x:500}]);await key('T',['alt']);await click(await at(140,230),'left');
        const pending=await run(`JSON.stringify(window.__wickline.views()[0].drawings.pending)`);
        const old=await anchor('old');mouse('mouseMove',old,'none');await wait(50);
        // Let the normal hover and press settle before measuring movement during the held gesture.
        mouse('mouseDown',old);await wait(40);
        const before=await run(`JSON.stringify(window.__wickline.views()[0].drawings.pending)`);
        mouse('mouseMove',await at(600,280));await wait(50);
        const holding=await run(`({active:document.querySelector('#charts').classList.contains('middle-erasing'),cursor:getComputedStyle(document.querySelector('.chart-host')).cursor==='default',frozen:JSON.stringify(window.__wickline.views()[0].drawings.pending)===${JSON.stringify(before)}})`);
        check('holding middle keeps a normal arrow cursor and freezes an unfinished preview', holding.active && holding.cursor && holding.frozen, JSON.stringify(holding));
        mouse('mouseUp',await at(600,280));await wait(40);
        check('release restores the previous tool and keeps the unfinished drawing anchor', await idle() && await run(`window.__wickline.views()[0].drawings.tool==='trend' && window.__wickline.views()[0].drawings.pending.id===${JSON.stringify(JSON.parse(pending).id)} && JSON.stringify(window.__wickline.views()[0].drawings.pending.p1)===${JSON.stringify(JSON.stringify(JSON.parse(pending).p1))}`));
        await click(await at(620,260),'left');
        check('left drawing completes normally after a temporary erase', await run(`window.__wickline.views()[0].drawings.items.length===1 && window.__wickline.views()[0].drawings.items[0].type==='trend' && !window.__wickline.views()[0].drawings.pending`));
        await fixture([{id:'erase-before-delete',x:200},{id:'selected-for-delete',x:550}]);
        await run(`window.__wickline.views()[0].drawings.select('selected-for-delete')`);
        const deleting=await anchor('erase-before-delete');mouse('mouseMove',deleting,'none');mouse('mouseDown',deleting);await wait(40);await key('Delete');
        check('Delete ends erasing and retains the existing selected-drawing deletion behavior', await idle() && (await ids()).length===0);
        mouse('mouseUp',deleting);await key('Z',['control']);
        check('Delete remains its own undo step after ending a held eraser', (await ids()).join()==='selected-for-delete');
        await fixture([]);await key('T',['alt']);await click(await at(130,220),'left');
        const escape=await at(600,250);mouse('mouseMove',escape,'none');mouse('mouseDown',escape);await wait(30);await key('Escape');
        check('Escape ends erasing and still cancels the unfinished drawing normally', await idle() && await run(`!window.__wickline.views()[0].drawings.pending && window.__wickline.views()[0].drawings.tool==='cursor'`));
        mouse('mouseUp',escape);
        await fixture([]);
        const span=()=>run(`(()=>{const r=window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange();return r.to-r.from})()`);
        const wheel=await at(500,240);mouse('mouseMove',wheel,'none');await wait(80);const oldSpan=await span();
        win.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(wheel.x),y:Math.round(wheel.y),deltaX:0,deltaY:-120,canScroll:true});await wait(250);
        check('ordinary wheel zoom remains enabled', Math.abs((await span())-oldSpan)>1);
        const pan=await at(500,260);mouse('mouseMove',pan,'none');await wait(50);win.webContents.focus();
        const range=await run(`JSON.stringify(window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange())`);
        mouse('mouseDown',pan,'left');await win.webContents.capturePage();
        // Hidden windows can coalesce all moves into one; deliver rendered frames like a visible drag.
        for(let i=1;i<=8;i++){mouse('mouseMove',{x:pan.x+i*10,y:pan.y},'left');await frame();await wait(20)}mouse('mouseUp',{x:pan.x+80,y:pan.y},'left');await wait(150);
        const panned=await run(`JSON.stringify(window.__wickline.views()[0].chart.timeScale().getVisibleLogicalRange())`);
        check('left-button chart panning still works after erasing',range!==panned,`before=${range}, after=${panned}`);
        mouse('mouseMove',await at(450,220),'none');await wait(50);
        check('normal crosshair updates resume after erasing', await run(`!!window.__wickline.views()[0].lastCrosshair?.point`));
        await run(`window.__right=false;window.addEventListener('contextmenu',e=>setTimeout(()=>{window.__right=!e.defaultPrevented},0),true)`);
        await click(await at(500,220),'right');
        check('right-click behavior is not suppressed', await run(`window.__right`));
        const outside=await run(`(()=>{const r=document.querySelector('#theme-btn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await run(`window.__middleDefault=[]`);await click(outside);
        check('middle-button behavior outside the chart is not intercepted', await run(`window.__middleDefault.length>0 && window.__middleDefault.every(e=>!e.prevented)`));

        await prepare();await fixture([{id:'axis-keep',x:200}]);
        const axis=await run(`(()=>{const r=window.__wickline.views()[0].chartEl.getBoundingClientRect();return {x:r.right-15,y:r.top+170}})()`);
        await click(axis);
        const pane=await run(`(()=>{const r=window.__wickline.views()[0].chart.panes()[1].getHTMLElement().getBoundingClientRect();return {x:r.left+200,y:r.top+25}})()`);await click(pane);
        check('price axes and indicator panes cannot erase main-pane drawings', (await ids()).join()==='axis-keep');
        const safe=await at(600,230);
        mouse('mouseMove',safe,'none');mouse('mouseDown',safe);await run(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__middlePointer}))`);mouse('mouseUp',safe);await wait(30);
        check('pointer cancellation restores the tool and cursor state', await idle());
        mouse('mouseDown',safe);await run(`document.querySelector('#charts').releasePointerCapture(window.__middlePointer)`);mouse('mouseMove',{x:safe.x+2,y:safe.y});mouse('mouseUp',safe);await wait(40);
        check('lost pointer capture cannot leave the eraser stuck', await idle());
        mouse('mouseDown',safe);mouse('mouseMove',{x:-20,y:-20});mouse('mouseLeave',{x:-20,y:-20},'none');await wait(40);
        check('leaving the window terminates the temporary mode', await idle());mouse('mouseUp',safe);
        // Use native focus transitions, off-screen and absent from the taskbar, rather than dispatching a synthetic blur.
        win.setSkipTaskbar(true);win.setPosition(-10000,-10000);win.show();win.focus();await wait(100);
        mouse('mouseMove',safe,'none');mouse('mouseDown',safe);await wait(30);
        const other=new BrowserWindow({show:false,skipTaskbar:true,x:-10000,y:-10000});await other.loadURL('about:blank');other.show();other.focus();await wait(100);
        check('focus moving to another Electron window ends the gesture',!win.isFocused() && other.isFocused() && await idle());
        other.destroy();win.hide();win.webContents.focus();mouse('mouseUp',safe);

        await run(`document.querySelector('#layout-menu [data-layout="2v"]').click()`);
        await until(`window.__wickline.views().length===2`);await prepare();await wait(100);
        await fixture([{id:'left-target',x:130},{id:'left-keep',x:290}]);
        await fixture([{id:'right-target',x:130},{id:'right-keep',x:290}],1);
        const left=await anchor('left-target'),right=await anchor('right-target',1);
        mouse('mouseMove',left,'none');mouse('mouseDown',left);mouse('mouseMove',right);mouse('mouseUp',right);await wait(80);
        check('a multi-chart sweep deletes only drawings under the current pointer in each chart', (await ids()).join()==='left-keep' && (await ids(1)).join()==='right-keep');
        await key('Z',['control']);
        check('Undo targets the last erased chart without restoring or deleting the other chart', (await ids()).join()==='left-keep' && (await ids(1)).join()==='right-target,right-keep');
        await key('Y',['control']);
        check('Redo remains local to the active chart after a cross-chart sweep', (await ids()).join()==='left-keep' && (await ids(1)).join()==='right-keep');
        await run(`document.querySelector('#theme-btn').click()`);
        const keep=await anchor('right-keep',1);await click(keep);
        check('middle erasing works in the light theme', await run(`document.documentElement.dataset.theme==='light'`) && (await ids(1)).length===0 && await idle());

        await fixture([{id:'deleted-left',x:120},{id:'survivor-left',x:280}]);
        await fixture([{id:'deleted-right',x:120},{id:'survivor-right',x:280}],1);
        await click(await anchor('deleted-left'));await click(await anchor('deleted-right',1));
        await until(`JSON.parse(localStorage.getItem('wickline.workspace'))?.layout==='2v'`);
        check('indicators and candle series remain intact after all erasing interactions', await run(`window.__wickline.views().every(v=>v.state.indicators.length===3 && v.main.data().length===220 && [...v.live.values()].every(e=>e.out && e.series.every(s=>s.api.data().length>0)))`));
        const expected=await run(`window.__wickline.views().map(v=>v.drawings.items)`);
        writeFileSync(path.join(profile,'eraser-expected.json'),JSON.stringify(expected));
        await run(`window.__wickline.views().forEach(v=>{v.drawings.items=[];v.drawings._changed(true);v.setAllIndicatorsHidden(false)})`);
        await prepare();await frame();await wait(150);
        const indicatorTypes=(i=0)=>run(`window.__wickline.views()[${i}].state.indicators.map(i=>i.type)`);
        const indicatorPoint=(type,view=0,plot=0)=>run(`(()=>{const v=window.__wickline.views()[${view}],e=[...v.live.values()].find(e=>e.inst.type===${JSON.stringify(type)}),api=e.series[${plot}].api,pane=api.getPane().getHTMLElement(),r=pane.getBoundingClientRect(),host=v.chartEl.getBoundingClientRect(),range=v.chart.timeScale().getVisibleLogicalRange(),index=Math.floor((Math.max(30,range.from)+Math.min(v.bars.length-2,range.to))/2),d=api.dataByIndex(index);return {x:host.left+v.chart.timeScale().logicalToCoordinate(index),y:r.top+api.priceToCoordinate(d.value)}})()`);
        const legendPoint=(type,view=0)=>run(`(()=>{const v=window.__wickline.views()[${view}],e=[...v.live.values()].find(e=>e.inst.type===${JSON.stringify(type)}),r=e.row.querySelector('.lg-name').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await click(await indicatorPoint('ema'));
        check('native middle click on an overlay plot removes only that indicator', (await indicatorTypes()).join()==='volume,rsi' && (await indicatorTypes(1)).length===3);
        await click(await indicatorPoint('rsi'));
        check('native middle click on a separate-pane plot removes that indicator and its pane', (await indicatorTypes()).join()==='volume' && await run(`window.__wickline.views()[0].chart.panes().length===1`));
        await run(`window.__wickline.views()[0].addIndicator('ema')`);await frame();await wait(100);
        await click(await legendPoint('ema'));
        check('middle clicking an indicator name removes it through the same saved action', (await indicatorTypes()).join()==='volume');
        await click(await indicatorPoint('volume'));
        check('volume is removable as an indicator without deleting the price series', (await indicatorTypes()).length===0 && await run(`window.__wickline.views()[0].main.data().length===220`));
        await run(`(()=>{const v=window.__wickline.views()[0];v.addIndicator('ema');v.addIndicator('sma');for(const e of v.live.values()){e.inst.params.length=e.inst.type==='ema'?9:40;v.computeAndSet(e)}})()`);
        await frame();await wait(120);
        const ema=await indicatorPoint('ema'),sma=await indicatorPoint('sma');
        const sweepStart={x:ema.x,y:Math.min(ema.y,sma.y)-35},sweepEnd={x:ema.x,y:Math.max(ema.y,sma.y)+35};
        mouse('mouseMove',sweepStart,'none');mouse('mouseDown',sweepStart);mouse('mouseMove',sweepEnd);mouse('mouseUp',sweepEnd);await wait(100);
        check('one fast native sweep removes several indicator plots between endpoints', (await indicatorTypes()).length===0);
        await run(`window.__wickline.views()[0].addIndicator('macd')`);await frame();await wait(120);
        await click(await indicatorPoint('macd',0,0));
        check('hitting one plot removes the entire multi-plot indicator without orphan series', (await indicatorTypes()).length===0 && await run(`window.__wickline.views()[0].chart.panes().length===1`));
        await run(`(()=>{const v=window.__wickline.views()[0];v.addIndicator('ema');v.setAllIndicatorsHidden(true)})()`);
        const hidden=await indicatorPoint('ema');await click(hidden);
        check('hidden indicator plots cannot be erased by invisible geometry', (await indicatorTypes()).join()==='ema');
        await run(`window.__wickline.views()[0].setAllIndicatorsHidden(false)`);await frame();await wait(100);
        const protectedChart=await run(`({type:window.__wickline.views()[0].main.seriesType(),bars:window.__wickline.views()[0].main.data().length})`);
        const empty=await at(30,300);await click(empty);
        check('empty plot space and the main price series remain protected', (await indicatorTypes()).join()==='ema' && protectedChart.bars===220 && await run(`window.__wickline.views()[0].main.data().length===220`));
        await click(await indicatorPoint('ema'));
        check('indicator deletion is confined to the pointer chart in a multi-chart layout', (await indicatorTypes()).length===0 && (await indicatorTypes(1)).length===3);
        await until(`JSON.parse(localStorage.getItem('wickline.workspace')).charts[0].indicators.length===0`);
        check('indicator deletion is saved to the existing workspace', await run(`JSON.parse(localStorage.getItem('wickline.workspace')).charts[0].indicators.length===0`));
        writeFileSync(path.join(profile,'eraser-expected.json'),JSON.stringify(await run(`window.__wickline.views().map(v=>v.drawings.items)`)));
        writeFileSync(path.join(profile,'eraser-indicators-expected.json'),JSON.stringify(await run(`window.__wickline.views().map(v=>v.state.indicators)`)));
        check('drawing deletion uses the existing per-symbol storage immediately', await run(`window.__wickline.views().every(v=>JSON.stringify(v.drawings.items)===localStorage.getItem('wickline.drawings.'+v.state.symbol))`));
      }
      check('no application console errors',errors.length===0,errors.join('; '));
      session.defaultSession.flushStorageData();await session.defaultSession.cookies.flushStore();
      console.log(`middle mouse eraser Electron ${process.argv.at(-1)}: ${passed} passed, ${failed} failed`);
      win.destroy();app.exit(failed?1:0);
    } catch(error) {console.error(error);if(errors.length)console.error(errors.join('\n'));win.destroy();app.exit(1)}
  }).catch(error=>{console.error(error);app.exit(1)});
}
