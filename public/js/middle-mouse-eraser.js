// Temporary middle-button gesture. Drawing geometry, deletion and storage belong to DrawingLayer.
const STEP_PX = 4; // smaller than the drawing hit tolerance, including between fast pointer events
const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

export function eraseAlong(layer, from, to, seen, eraseAt = (x, y, visited) => layer.eraseAt(x, y, visited), valid = () => true) {
  if (!finite(to)) return [];
  const distance = finite(from) ? Math.hypot(to.x - from.x, to.y - from.y) : null;
  if (distance === 0) return [];
  const steps = distance == null ? 1 : Math.ceil(distance / STEP_PX);
  const removed = [];
  for (let i = 1; i <= steps && valid(); i++) {
    const t = i / steps;
    const id = eraseAt(distance == null ? to.x : from.x + (to.x - from.x) * t,
      distance == null ? to.y : from.y + (to.y - from.y) * t, seen);
    if (id) removed.push(id);
  }
  return removed;
}

export class MiddleMouseEraser {
  /** targetAt(event): { layer, host, point }, or null outside a chart. A null point is an axis/pane/UI boundary. */
  constructor(root, targetAt) {
    this.root = root;
    this.targetAt = targetAt;
    this.session = null;
    const win = root.ownerDocument.defaultView;
    const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    this.listeners = [];
    const listen = (el, type, fn) => {
      el.addEventListener(type, fn, { capture: true, passive: false });
      this.listeners.push(() => el.removeEventListener(type, fn, true));
    };
    listen(root, 'pointerdown', (e) => {
      if (this.session) { stop(e); return; }
      if (e.button !== 1 || (e.pointerType && e.pointerType !== 'mouse')) return;
      const target = this.targetAt(e);
      if (!target) return;
      stop(e); // also suppress browser autoscroll over a chart axis or indicator pane
      if (!target.point || target.layer.drag) return;
      this.session = { pointerId: e.pointerId, entries: new Map(), previous: null };
      try { root.setPointerCapture(e.pointerId); } catch { /* the window may have lost the pointer */ }
      this.visit(e);
    });
    listen(root, 'mousedown', (e) => {
      if (this.session || (e.button === 1 && this.targetAt(e))) stop(e);
    });
    listen(root, 'auxclick', (e) => { if (e.button === 1 && this.targetAt(e)) stop(e); });
    listen(root, 'click', (e) => { if (this.session) stop(e); });
    listen(win, 'pointermove', (e) => {
      if (!this.session || e.pointerId !== this.session.pointerId) return;
      if (e.clientX < 0 || e.clientY < 0 || e.clientX >= win.innerWidth || e.clientY >= win.innerHeight) {
        this.finish(); return;
      }
      if (!(e.buttons & 4)) { this.finish(); return; }
      const samples = e.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [e]) {
        if (!this.session) break;
        this.visit(sample);
      }
    });
    const release = (e) => {
      if (!this.session || e.button !== 1 || (e.pointerId != null && e.pointerId !== this.session.pointerId)) return;
      this.visit(e); // include a final movement, but never erase a stationary click twice
      stop(e);
      this.finish();
    };
    listen(win, 'pointerup', release);
    listen(win, 'mouseup', release); // pointerup waits for all buttons when buttons are chorded
    listen(win, 'pointercancel', (e) => { if (e.pointerId === this.session?.pointerId) this.finish(); });
    listen(root, 'lostpointercapture', (e) => { if (e.pointerId === this.session?.pointerId) this.finish(); });
    listen(win, 'pointerout', (e) => { if (!e.relatedTarget) this.finish(); });
    // Pointer capture can suppress pointerout when the mouse leaves the native window.
    listen(win, 'mouseout', (e) => { if (!e.relatedTarget) this.finish(); });
    listen(win, 'mouseleave', (e) => { if (!e.relatedTarget) this.finish(); });
    for (const type of ['blur', 'pagehide']) listen(win, type, () => this.finish());
    listen(win, 'keydown', (e) => {
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) this.finish();
    });
    listen(root.ownerDocument, 'visibilitychange', () => { if (root.ownerDocument.hidden) this.finish(); });
  }

  visit(e) {
    const session = this.session;
    const target = this.targetAt(e);
    if (!session) return;
    // Symbol/series changes invalidate a gesture; never apply old coordinates to new drawings.
    for (const [layer, entry] of session.entries) {
      if (layer.key !== entry.key || layer.series !== entry.series) { this.finish(); return; }
    }
    if (session.lastClient?.x === e.clientX && session.lastClient?.y === e.clientY) return;
    session.lastClient = { x: e.clientX, y: e.clientY };
    if (!target?.point || !finite(target.point)) {
      session.previous = null;
      this.root.classList.remove('middle-erasing');
      return;
    }
    const { layer, host, point } = target;
    if (layer.drag) { this.finish(); return; }
    target.activate?.();
    if (!session.entries.has(layer)) {
      session.entries.set(layer, { key: layer.key, series: layer.series, host, cursor: host.style.cursor, seen: new Set() });
      layer.beginErase();
    }
    this.root.classList.add('middle-erasing');
    const scope = target.scope ?? layer;
    const previous = session.previous?.scope === scope ? session.previous.point : null;
    eraseAlong(layer, previous, point, session.entries.get(layer).seen, target.eraseAt, target.valid);
    target.flush?.();
    session.previous = target.valid?.() === false ? null : { scope, point: { ...point } };
  }

  finish() {
    const session = this.session;
    if (!session) return;
    this.session = null;
    this.root.classList.remove('middle-erasing');
    for (const [layer, entry] of session.entries) {
      layer.endErase();
      entry.host.style.cursor = entry.cursor;
    }
    try { this.root.releasePointerCapture(session.pointerId); } catch { /* already released */ }
  }

  destroy() {
    this.finish();
    this.listeners.forEach((remove) => remove());
  }
}
