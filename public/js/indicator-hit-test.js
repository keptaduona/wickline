import { distToSegment } from './drawings.js';
import { isHidden } from './entry-visibility.js';

function seriesHit(api, scale, logical, x, y) {
  const options = api.options();
  if (options.visible === false) return false;
  const tolerance = Math.max(4, options.hitTestTolerance ?? 3);
  const at = (i, direction) => {
    const item = api.dataByIndex(i, direction);
    if (!Number.isFinite(item?.value)) return null;
    const px = scale.timeToCoordinate(item.time), py = api.priceToCoordinate(item.value);
    return px == null || py == null ? null : { x: px, y: py };
  };
  if (api.seriesType() === 'Histogram') {
    const p = at(Math.round(logical), 0), base = api.priceToCoordinate(options.base ?? 0);
    return p && base != null && Math.abs(x - p.x) <= scale.options().barSpacing * 0.45 + tolerance
      && y >= Math.min(p.y, base) - tolerance && y <= Math.max(p.y, base) + tolerance;
  }
  if (api.seriesType() !== 'Line') return false;
  const index = Math.floor(logical);
  const points = [at(index - 1, -1), at(index, -1), at(index + 1, 1)];
  if (options.pointMarkersVisible) {
    const radius = (options.pointMarkersRadius ?? 2) + tolerance;
    if (points.some((p) => p && Math.hypot(x - p.x, y - p.y) <= radius)) return true;
  }
  if (options.lineVisible === false) return false;
  const margin = tolerance + (options.lineWidth ?? 2) / 2;
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1], right = points[i];
    if (!left || !right) continue;
    const distance = options.lineType === 1
      ? Math.min(distToSegment(x, y, left.x, left.y, right.x, left.y), distToSegment(x, y, right.x, left.y, right.x, right.y))
      : distToSegment(x, y, left.x, left.y, right.x, right.y);
    if (distance <= margin) return true;
  }
  return false;
}

/** Only registered indicator series participate; never the main price or comparison series. */
export function hitIndicator(entries, scale, paneElement, x, y, seen) {
  const logical = scale.coordinateToLogical(x);
  if (!Number.isFinite(logical)) return null;
  const candidates = [];
  for (const entry of entries) {
    if (isHidden(entry.inst) || entry.offChart || seen?.has(`indicator:${entry.inst.id}`)) continue;
    for (const { api } of entry.series) {
      if (api.getPane().getHTMLElement() === paneElement) candidates.push({ entry, api });
    }
  }
  candidates.sort((a, b) => b.api.seriesOrder() - a.api.seriesOrder());
  for (const { entry, api } of candidates) {
    if (seriesHit(api, scale, logical, x, y)) return entry.inst.id;
    if (api === entry.series[0]?.api && api.options().visible !== false) {
      for (const line of entry.levelLines || []) {
        const options = line.options(), ly = api.priceToCoordinate(options.price);
        if (options.lineVisible !== false && ly != null && Math.abs(y - ly) <= 4 + (options.lineWidth ?? 1) / 2) return entry.inst.id;
      }
    }
  }
  return null;
}
