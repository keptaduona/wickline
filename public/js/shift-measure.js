// Own only the temporary pointer gesture; the drawing layer owns measurement coordinates and rendering.
export class ShiftDragMeasure {
  constructor(host, layer, { pointAt, canStart }) {
    this.host = host;
    this.layer = layer;
    this.pointAt = pointAt;
    this.canStart = canStart;
    this.session = null;
    this.suppressClick = false;
    this.listeners = [];
    const doc = host.ownerDocument, win = doc.defaultView;
    const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const listen = (target, type, fn) => {
      const options = { capture: true, passive: false };
      target.addEventListener(type, fn, options);
      this.listeners.push(() => target.removeEventListener(type, fn, options));
    };
    listen(win, 'pointerdown', (e) => {
      if (this.session) {
        if (e.pointerId !== this.session.pointerId || e.button !== 0 || !host.contains(e.target)) this.cancel();
        return;
      }
      this.suppressClick = false;
      layer.clearMeasurement();
    });
    listen(host, 'pointerdown', (e) => {
      if (this.session) {
        if (e.pointerId !== this.session.pointerId || e.button !== 0) return;
        const point = pointAt(e, false);
        if (!point || !this.move(e)) { this.cancel(); return; }
        stop(e);
        this.finish();
        return;
      }
      if (e.button !== 0 || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey
        || (e.pointerType && e.pointerType !== 'mouse') || (e.buttons != null && e.buttons !== 1) || !canStart()) return;
      const point = pointAt(e, false);
      if (!point || !canStart(point) || !layer.beginMeasurement(point.x, point.y)) return;
      stop(e);
      this.suppressClick = true;
      this.session = { pointerId: e.pointerId, key: layer.key, series: layer.series,
        startX: e.clientX, startY: e.clientY, moved: false, captured: true };
      host.classList.add('shift-measuring');
      try { host.setPointerCapture(e.pointerId); } catch { this.cancel(); }
    });
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
      listen(host, type, (e) => { if (this.suppressClick && e.button === 0) stop(e); });
    }
    listen(win, 'pointermove', (e) => {
      if (!this.session || e.pointerId !== this.session.pointerId) return;
      if ((e.buttons & ~1) || e.clientX < 0 || e.clientY < 0 || e.clientX >= win.innerWidth || e.clientY >= win.innerHeight) { this.cancel(); return; }
      this.move(e);
    });
    const release = (e) => {
      const s = this.session;
      if (!s || e.button !== 0 || (e.pointerId != null && e.pointerId !== s.pointerId)) return;
      this.move(e);
      stop(e);
      if (this.session) this.releaseCapture(s);
    };
    listen(win, 'pointerup', release);
    listen(win, 'mouseup', release);
    listen(win, 'pointercancel', (e) => { if (e.pointerId === this.session?.pointerId) this.cancel(); });
    listen(host, 'lostpointercapture', (e) => {
      if (e.pointerId === this.session?.pointerId && this.session.captured) this.cancel();
    });
    for (const type of ['mouseout', 'pointerout']) listen(win, type, (e) => { if (!e.relatedTarget && this.session) this.cancel(); });
    for (const type of ['blur', 'pagehide']) listen(win, type, () => this.cancel());
    listen(doc, 'visibilitychange', () => { if (doc.hidden) this.cancel(); });
    listen(win, 'keydown', (e) => {
      if (e.key === 'Escape' && (this.session || layer.measurement)) { stop(e); this.cancel(); }
      else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) && this.session) this.cancel();
    });
  }

  move(e) {
    const s = this.session;
    if (!s) return false;
    if (this.layer.key !== s.key || this.layer.series !== s.series || !this.layer.measuring || !this.canStart()) { this.cancel(); return false; }
    const p = this.pointAt(e, true);
    if (!p) { this.cancel(); return false; }
    if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) >= 3) s.moved = true;
    this.layer.moveMeasurement(p.x, p.y);
    return true;
  }

  releaseCapture(s) {
    if (!s.captured) return;
    // The first click releases native capture; free mouse movement still updates the pending endpoint.
    s.captured = false;
    try { this.host.releasePointerCapture(s.pointerId); } catch { /* capture may already be gone */ }
  }

  finish() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.host.classList.remove('shift-measuring');
    if (s.moved && this.layer.key === s.key && this.layer.series === s.series) this.layer.endMeasurement();
    else this.layer.clearMeasurement();
    this.releaseCapture(s);
  }

  cancel() {
    this.layer.clearMeasurement();
    this.finish();
  }

  destroy() {
    this.cancel();
    this.listeners.forEach((remove) => remove());
  }
}
