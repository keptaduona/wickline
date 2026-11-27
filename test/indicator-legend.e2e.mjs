// Offline Electron checks, including real pointer/keyboard input and a second process restart.
// Run: npm run test:e2e:legend. Optional screenshots: WICKLINE_LEGEND_SHOTS=<directory>.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  const profile = mkdtempSync(path.join(os.tmpdir(), 'wickline-legend-'));
  const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
  try {
    for (const phase of ['exercise', 'restore']) {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(electron, [file, phase], {
          windowsHide: true, stdio: 'inherit',
          env: { ...process.env, WICKLINE_LEGEND_PROFILE: profile, WICKLINE_LEGEND_ORIGIN: `http://127.0.0.1:${port}` },
        });
        const timer = setTimeout(() => { child.kill(); reject(new Error(`${phase} timed out`)); }, 120000);
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
      });
      assert.equal(code, 0, `${phase} failed`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    server.close();
  }
} else {
  const { app, BrowserWindow, session } = await import('electron');
  const profile = process.env.WICKLINE_LEGEND_PROFILE;
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('lang', 'en-US');
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    const origin = process.env.WICKLINE_LEGEND_ORIGIN;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      callback({ cancel: url.origin !== origin || (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') });
    });
    const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' && !/Failed to load resource|ERR_ABORTED/.test(event.message)) errors.push(event.message);
    });
    let passed = 0, failed = 0, page = 0;
    const check = (name, ok, detail = '') => {
      if (ok) passed++; else failed++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
    };
    const run = (code) => win.webContents.executeJavaScript(code);
    const until = async (condition) => {
      for (let i = 0; i < 150; i++) { if (await run(condition)) return; await wait(40); }
      throw new Error(`Timed out: ${condition}`);
    };
    const open = async () => {
      await win.loadURL(`${origin}/?e2e&page=${++page}`);
      await until(`!!window.__wickline?.views().length && !!document.querySelector('.lg-toggle')`);
    };
    const prepare = () => run(`(() => { for (const v of window.__wickline.views()) {
      v.loadGen++; v.feed?.close(); v.feed = { close() {}, canLoadMore: false };
      v.bars = Array.from({length: 220}, (_, i) => ({time: 1700000000 + i * 86400, open: 100 + i * .12 + Math.sin(i / 5) * 6,
        high: 104 + i * .12 + Math.sin(i / 5) * 6, low: 97 + i * .12 + Math.sin(i / 5) * 6,
        close: 102 + i * .12 + Math.sin(i / 5) * 6, volume: 1000 + i * 20}));
      v.meta = { precision: 2, tzOffset: 0, name: 'Synthetic UI data' }; v.renderAll(true); v.updateTitle();
      v.showError(null); v.q('.overlay.loading').hidden = true;
    } })()`);
    const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const toggle = (i = 0) => run(`window.__wickline.views()[${i}].q('.lg-toggle').click()`);
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    const pointerToggle = async (index = 0) => {
      const p = await run(`(() => { const r = window.__wickline.views()[${index}].q('.lg-toggle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      win.webContents.focus(); mouse('mouseMove', p.x, p.y); mouse('mouseDown', p.x, p.y); mouse('mouseUp', p.x, p.y); await wait(60);
    };
    const capture = async (name) => {
      if (!process.env.WICKLINE_LEGEND_SHOTS) return;
      mkdirSync(process.env.WICKLINE_LEGEND_SHOTS, { recursive: true });
      await run(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await wait(150);
      writeFileSync(path.join(process.env.WICKLINE_LEGEND_SHOTS, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const snapshot = `window.__wickline.views().map(v => ({ collapsed: v.state.indicatorLegendCollapsed, indicators: v.state.indicators, symbol: v.state.symbol, tf: v.state.tf }))`;
    try {
      await open();
      await prepare();
      if (process.argv.at(-1) === 'restore') {
        const expected = JSON.parse(readFileSync(path.join(profile, 'legend-expected.json'), 'utf8'));
        check('a new Electron process restores all per-chart states and indicator configurations', JSON.stringify(await run(snapshot)) === JSON.stringify(expected));
        check('restart restores the collapsed count and the other chart stays expanded', await run(`(() => { const [a,b] = window.__wickline.views(); return a.q('.lg-toggle span').textContent === String(a.state.indicators.length) && a.q('.lg-toggle').getAttribute('aria-expanded') === 'false' && b.q('.lg-toggle').getAttribute('aria-expanded') === 'true'; })()`));
        check('restored indicators still calculate and draw', await run(`window.__wickline.views().every(v => [...v.live.values()].filter(e => !e.script).every(e => !!e.out && e.series.every(s => s.api.data().length > 0)))`));
      } else {
        check('new users see the original overlay and pane legends with an expanded toggle', await run(`(() => { const v=window.__wickline.views()[0]; return !v.state.indicatorLegendCollapsed && v.state.indicators.length === 3 && !v.q('.lg-toggle').hidden && v.q('.lg-toggle').getAttribute('aria-expanded') === 'true' && [...v.el.querySelectorAll('.lg-row[data-id]')].every(r => r.getClientRects().length); })()`));
        await capture('dark-expanded');
        await run(`(() => { const v=window.__wickline.views()[0]; const row=[...v.live.values()].find(e=>e.inst.type==='ema').row; const r=row.getBoundingClientRect();
          window.__oldLegendPoint={x:r.left+20,y:r.top+r.height/2};
          window.__legendBefore={ chart:v.chart, main:v.main, series:[...v.live.values()].flatMap(e=>e.series.map(s=>s.api)),
            indicators:JSON.stringify(v.state.indicators), visible:[...v.live.values()].flatMap(e=>e.series.map(s=>s.api.options().visible)),
            range:JSON.stringify(v.chart.timeScale().getVisibleLogicalRange()), scale:JSON.stringify(v.main.priceScale().options()) };
          window.__legendLeaks=0; for(const type of ['pointerdown','mousedown','mouseup','click','keydown','keyup']) document.addEventListener(type, () => window.__legendLeaks++);
          v.setTool('trend'); })()`);
        await pointerToggle();
        check('a real mouse click collapses all indicator rows and displays the total count', await run(`(() => {const v=window.__wickline.views()[0]; return v.state.indicatorLegendCollapsed && v.q('.lg-toggle span').textContent === '3' && [...v.el.querySelectorAll('.lg-row[data-id]')].every(r => !r.getClientRects().length) && getComputedStyle(v.q('.pane-legends')).display === 'none';})()`));
        check('collapsed rows release their former hit-test area to the chart', await run(`!document.elementFromPoint(window.__oldLegendPoint.x,window.__oldLegendPoint.y).closest('.legend, .pane-legends')`));
        check('collapse preserves chart, series, indicator settings, visibility, scale and scroll', await run(`(() => {const v=window.__wickline.views()[0], b=window.__legendBefore; return v.chart===b.chart && v.main===b.main && [...v.live.values()].flatMap(e=>e.series.map(s=>s.api)).every((api,i)=>api===b.series[i]) && JSON.stringify(v.state.indicators)===b.indicators && JSON.stringify([...v.live.values()].flatMap(e=>e.series.map(s=>s.api.options().visible)))===JSON.stringify(b.visible) && JSON.stringify(v.chart.timeScale().getVisibleLogicalRange())===b.range && JSON.stringify(v.main.priceScale().options())===b.scale;})()`));
        check('the toggle neither bubbles chart input nor starts a drawing', await run(`window.__legendLeaks === 0 && window.__wickline.views()[0].drawings.pending === null && window.__wickline.views()[0].drawings.items.length === 0 && window.__wickline.views()[0].drawings.tool === 'trend'`));
        await capture('dark-collapsed');
        const live = await run(`(() => { const v=window.__wickline.views()[0], e=[...v.live.values()].find(e=>e.inst.type==='ema'); const before=e.out.ma.at(-1); v.bars.at(-1).close+=12; v.dirtyFrom=v.bars.length-1; v.flush(); return {before, after:e.out.ma.at(-1), drawn:e.series[0].api.data().at(-1).value, visible:e.series[0].api.options().visible}; })()`);
        check('collapsed indicators continue computing and updating their drawn series', live.after !== live.before && live.drawn === live.after && live.visible, JSON.stringify(live));
        await click('#theme-btn'); await wait(80);
        check('the compact button works in the light theme', await run(`document.documentElement.dataset.theme === 'light' && document.querySelector('.lg-toggle').getBoundingClientRect().height === 20`));
        await capture('light-collapsed');
        await run(`window.__legendLeaks=0; document.querySelector('.lg-toggle').focus()`);
        // Like a real Enter press, include its character event for Chromium's native button action.
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await wait(60);
        check('Enter expands the legend with its original rows and actions', await run(`!window.__wickline.views()[0].state.indicatorLegendCollapsed && [...document.querySelectorAll('.lg-row[data-id]')].every(r => r.getClientRects().length) && window.__legendLeaks===0`));
        await capture('light-expanded');
        for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: ' ' });
        await wait(60);
        check('Space collapses the legend without invoking global shortcuts', await run(`window.__wickline.views()[0].state.indicatorLegendCollapsed && window.__legendLeaks===0`));

        await click('#ind-btn'); await click('#ind-list [data-type="sma"]');
        check('adding an indicator through the dialog keeps the legend collapsed and updates its count', await run(`window.__wickline.views()[0].state.indicatorLegendCollapsed && document.querySelector('.lg-toggle span').textContent === '4'`));
        await run(`(async () => {const {scriptStore,TEMPLATES}=await import('./js/scripts.js'); const v=window.__wickline.views()[0];
          v.addScript(scriptStore.save({name:'Legend test',code:TEMPLATES[0].code}));
          v.addScript(scriptStore.save({name:'Legend strategy',code:TEMPLATES.find(t=>t.code.includes("strategy('")).code}));})()`);
        await until(`window.__wickline.views()[0].state.indicators.length === 6 && [...window.__wickline.views()[0].live.values()].filter(e=>e.script).every(e=>e.out && e.series.length && !e.running)`);
        check('script indicators and strategies keep rendering while their labels are collapsed', await run(`(() => { const v=window.__wickline.views()[0]; return v.state.indicatorLegendCollapsed && v.q('.lg-toggle span').textContent==='6' && [...v.live.values()].filter(e=>e.script).every(e=>e.series.every(s=>s.api.data().length>0)); })()`));
        await run(`window.__wickline.views()[0].addCompare('YAHOO:MSFT')`);
        check('comparison labels remain interactive and are not counted as indicators', await run(`(() => { const v=window.__wickline.views()[0]; return v.q('.lg-toggle span').textContent==='6' && !!v.q('.lg-row[data-cmp]').getClientRects().length && !v.q('.lg-row[data-id]').getClientRects().length; })()`));
        await run(`window.__wickline.views()[0].removeCompare('YAHOO:MSFT')`);
        await toggle();
        await click('.lg-row[data-id] [data-act="settings"]');
        check('indicator settings work after expanding', await run(`!document.querySelector('#ind-settings').hidden && !!document.querySelector('#ind-settings [data-act="close"]')`));
        await click('#ind-settings [data-act="close"]');
        await click('.lg-row[data-id] [data-act="eye"]');
        check('the existing eye action still changes only the indicator visibility', await run(`!!window.__wickline.views()[0].state.indicators[0].hidden && !window.__wickline.views()[0].state.indicatorLegendCollapsed`));
        await toggle(); await toggle();
        check('collapse and expand preserve an indicator hidden by its eye button', await run(`!!window.__wickline.views()[0].state.indicators[0].hidden && [...window.__wickline.views()[0].live.values()][0].series.every(s=>s.api.options().visible===false)`));
        await click('.lg-row[data-id] [data-act="remove"]');
        check('the remove action still works after expanding', await run(`window.__wickline.views()[0].state.indicators.length===5`));
        await toggle();
        await run(`(() => { const v=window.__wickline.views()[0]; for(const i of [...v.state.indicators].slice(1)) v.removeIndicator(i.id); })()`);
        check('one indicator can remain collapsed with count one', await run(`document.querySelector('.lg-toggle span').textContent==='1' && window.__wickline.views()[0].state.indicatorLegendCollapsed`));
        await run(`(() => { const v=window.__wickline.views()[0]; v.removeIndicator(v.state.indicators[0].id); })()`);
        check('removing the last indicator hides the toggle and leaves the price chart intact', await run(`document.querySelector('.lg-toggle').hidden && window.__wickline.views()[0].main.data().length===220`));
        await run(`window.__wickline.views()[0].addIndicator('ema')`);
        check('adding to an empty collapsed list restores the compact one-indicator button', await run(`!document.querySelector('.lg-toggle').hidden && document.querySelector('.lg-toggle span').textContent==='1' && window.__wickline.views()[0].state.indicatorLegendCollapsed`));
        await run(`window.__wickline.views()[0].setSymbol('YAHOO:MSFT')`); await prepare();
        check('changing the symbol retains the collapse preference', await run(`window.__wickline.views()[0].state.indicatorLegendCollapsed`));
        await run(`window.__wickline.views()[0].setTimeframe('4h')`); await prepare();
        check('changing the timeframe retains the collapse preference', await run(`window.__wickline.views()[0].state.indicatorLegendCollapsed`));
        await click('#layout-menu [data-layout="2v"]');
        await until(`window.__wickline.views().length===2`); await prepare();
        await toggle(1);
        check('two charts control their legends independently', await run(`window.__wickline.views()[0].state.indicatorLegendCollapsed && !window.__wickline.views()[1].state.indicatorLegendCollapsed`));
        // Workspace writes are debounced; fast runs may not have saved the new layout yet.
        await until(`JSON.parse(localStorage.getItem('wickline.workspace'))?.layout === '2v'`);
        await run(`(() => { const a=window.__wickline.views()[0]; a.setTool('trend'); window.__activeBefore=JSON.parse(localStorage.getItem('wickline.workspace')).active; })()`);
        await pointerToggle(1); await pointerToggle(1); await wait(200);
        check('toggling an inactive chart does not activate it or cancel the active drawing tool', await run(`JSON.parse(localStorage.getItem('wickline.workspace')).active===window.__activeBefore && window.__wickline.views()[0].drawings.tool==='trend'`));
        await click('#layout-menu [data-layout="1"]'); await click('#layout-menu [data-layout="2v"]');
        await until(`window.__wickline.views().length===2`); await prepare();
        check('removing and restoring a layout cell retains each saved preference', await run(`window.__wickline.views()[0].state.indicatorLegendCollapsed && !window.__wickline.views()[1].state.indicatorLegendCollapsed`));
        win.setSize(900, 650); await wait(80);
        check('the compact control stays usable in a narrow multi-chart window', await run(`[...document.querySelectorAll('.lg-toggle')].every(b=>{const r=b.getBoundingClientRect(), c=b.closest('.cell').getBoundingClientRect(); return r.width>0 && r.left>=c.left && r.right<=c.right;})`));
        await wait(220);
        const saved = await run(snapshot);
        await open(); await prepare();
        check('page reload restores the per-chart states and indicator settings', JSON.stringify(await run(snapshot))===JSON.stringify(saved));
        await run(`localStorage.setItem('wickline.lang',JSON.stringify('zh-CN'))`);
        await open(); await prepare();
        check('Simplified Chinese tooltips include the current count', await run(`document.querySelector('.lg-toggle').title==='展开指标列表（1 个指标）' && document.querySelectorAll('.lg-toggle')[1].title==='折叠指标列表'`));
        writeFileSync(path.join(profile, 'legend-expected.json'), JSON.stringify(await run(snapshot)));
        await wait(220);
      }
      check('no application console errors', errors.length === 0, errors.join('; '));
      session.defaultSession.flushStorageData();
      await session.defaultSession.cookies.flushStore();
      console.log(`indicator legend Electron ${process.argv.at(-1)}: ${passed} passed, ${failed} failed`);
      win.destroy(); app.exit(failed ? 1 : 0);
    } catch (error) {
      console.error(error);
      if (errors.length) console.error(errors.join('\n'));
      win.destroy(); app.exit(1);
    }
  }).catch((error) => { console.error(error); app.exit(1); });
}
