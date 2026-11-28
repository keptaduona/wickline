import { t, locale } from './i18n.js';

export function measurementStats(p1, p2, logicalFromTime, minMove) {
  const delta = p2.price - p1.price;
  return {
    delta,
    percent: p1.price ? delta / Math.abs(p1.price) * 100 : null,
    bars: Math.abs(Math.round(logicalFromTime(p2.time) - logicalFromTime(p1.time))),
    seconds: Math.abs(p2.time - p1.time),
    ticks: Number.isFinite(minMove) && minMove > 0 ? Math.round(delta / minMove) : null,
  };
}

export function measurementDuration(seconds) {
  let rest = Math.max(0, Math.round(Math.abs(seconds)));
  const parts = [];
  for (const [size, format] of [
    [86400, (n) => t('draw.durD', { n })],
    [3600, (n) => t('draw.durH', { n })],
    [60, (n) => t('draw.durM', { n })],
    [1, (n) => t('draw.durS', { n })],
  ]) {
    const n = Math.floor(rest / size);
    if (n) parts.push(format(n));
    rest %= size;
  }
  return parts.length ? parts.join(' ') : t('draw.durS', { n: 0 });
}

export function measurementText(stats, formatPrice) {
  const signed = (value, format) => `${value > 0 ? '+' : ''}${format(Object.is(value, -0) ? 0 : value)}`;
  const percent = stats.percent == null ? '—' : `${signed(stats.percent, (v) => v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}%`;
  const ticks = stats.ticks == null ? '' : ` ${signed(stats.ticks, (v) => v.toLocaleString(locale))}`;
  return `${signed(stats.delta, formatPrice)} (${percent})${ticks}\n${t('draw.measure', { n: stats.bars, dur: measurementDuration(stats.seconds) })}`;
}
