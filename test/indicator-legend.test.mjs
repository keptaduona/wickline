// Legend presentation and saved chart state, without creating charts or indicator series.
// Run: node test/indicator-legend.test.mjs
import assert from 'node:assert/strict';
// scripts.js listens for storage events; the chart library itself is never instantiated here.
globalThis.window = new EventTarget();
const { ChartView, normalizeChartState, cloneChartState } = await import('../public/js/chart-view.js');
const { store } = await import('../public/js/util.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok ${name}`); };

function view(state) {
  const counter = {};
  const attributes = {};
  const button = { setAttribute(k, v) { attributes[k] = v; }, querySelector() { return counter; } };
  const classes = new Set();
  const v = Object.create(ChartView.prototype);
  v.state = normalizeChartState(state);
  v.el = { classList: { toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } } };
  v.q = () => button;
  v.changes = 0;
  v.hooks = { onChange(x) { assert.equal(x, v); v.changes++; } };
  // A presentation toggle must not reach any chart, series, drawing or calculation operation.
  for (const key of ['chart', 'main', 'drawings', 'live']) Object.defineProperty(v, key, { get() { throw new Error(`Touched ${key}`); } });
  v.updateIndicatorLegend();
  return { v, button, counter, attributes, classes };
}

ok('older workspaces and invalid saved values default to expanded', () => {
  for (const value of [undefined, null, false, 0, 1, 'true', 'false', {}, []]) {
    assert.equal(normalizeChartState({ indicators: [], indicatorLegendCollapsed: value }).indicatorLegendCollapsed, false);
  }
  assert.equal(normalizeChartState({ indicators: [], indicatorLegendCollapsed: true }).indicatorLegendCollapsed, true);
});

ok('a single indicator can collapse without touching its data or any chart operation', () => {
  const { v, button, counter, attributes, classes } = view({ indicators: [{ id: 'ema', type: 'ema', params: { length: 21 }, hidden: true }] });
  const before = JSON.stringify(v.state.indicators);
  assert.equal(button.hidden, false);
  assert.equal(attributes['aria-expanded'], 'true');
  v.toggleIndicatorLegend();
  assert.equal(v.state.indicatorLegendCollapsed, true);
  assert.equal(counter.textContent, '1');
  assert.equal(counter.hidden, false);
  assert.equal(attributes['aria-expanded'], 'false');
  assert.equal(attributes['aria-label'], 'Expand indicator legend (1)');
  assert.ok(classes.has('indicators-collapsed'));
  assert.equal(JSON.stringify(v.state.indicators), before);
  assert.equal(v.changes, 1);
  v.toggleIndicatorLegend();
  assert.equal(v.state.indicatorLegendCollapsed, false);
  assert.equal(counter.hidden, true);
  assert.equal(v.changes, 2);
});

ok('count includes hidden indicators, pane indicators and scripts, not compare symbols', () => {
  const { v, counter } = view({ indicatorLegendCollapsed: true, indicators: [
    { id: 'a', type: 'ema', hidden: true }, { id: 'b', type: 'rsi' }, { id: 'c', type: 'script', scriptId: 'local' },
  ], compares: [{ symbol: 'YAHOO:MSFT' }] });
  assert.equal(counter.textContent, '3');
  v.state.indicators.push({ id: 'd', type: 'volume' });
  v.updateIndicatorLegend();
  assert.equal(counter.textContent, '4');
  assert.equal(v.state.indicatorLegendCollapsed, true);
});

ok('removing the last indicator hides the button and retains the saved preference', () => {
  const { v, button } = view({ indicators: [], indicatorLegendCollapsed: true });
  assert.equal(button.hidden, true);
  v.toggleIndicatorLegend();
  assert.equal(v.changes, 0);
  v.state.indicators.push({ type: 'ema' });
  v.updateIndicatorLegend();
  assert.equal(button.hidden, false);
  assert.equal(v.state.indicatorLegendCollapsed, true);
});

ok('chart states and their indicator settings remain independent after cloning', () => {
  const a = normalizeChartState({ indicatorLegendCollapsed: true });
  const b = cloneChartState(a);
  b.indicatorLegendCollapsed = false;
  b.indicators[0].hidden = true;
  assert.equal(a.indicatorLegendCollapsed, true);
  assert.equal(a.indicators[0].hidden, undefined);
  assert.notEqual(a.indicators[0].id, b.indicators[0].id);
});

ok('the existing workspace store restores per-chart collapse and indicator visibility separately', () => {
  const saved = new Map();
  globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  const workspace = { layout: '2v', charts: [normalizeChartState({ indicatorLegendCollapsed: true }), normalizeChartState()] };
  workspace.charts[0].indicators[0].hidden = true;
  store.set('workspace', workspace);
  assert.ok(saved.has('wickline.workspace'));
  const restored = store.get('workspace', null).charts.map(normalizeChartState);
  assert.deepEqual(restored.map((s) => s.indicatorLegendCollapsed), [true, false]);
  assert.deepEqual(restored.map((s) => s.indicators), workspace.charts.map((s) => s.indicators));
  delete globalThis.localStorage;
});

console.log(`indicator legend: ${n} checks passed`);
