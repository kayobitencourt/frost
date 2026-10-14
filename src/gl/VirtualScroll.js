// Wheel / touch / keyboard driven 0..1 progress with inertia.
export class VirtualScroll {
  constructor(target) {
    this.target = 0;
    this.current = 0;
    this.velocity = 0;
    this.enabled = false;
    this.el = target;
    let touchY = 0;

    this._wheel = (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? window.innerHeight : 1;
      this.target += Math.max(-120, Math.min(120, e.deltaY * unit)) * 0.00018;
    };
    this._touchStart = (e) => { touchY = e.touches[0].clientY; };
    this._touchMove = (e) => {
      if (!this.enabled) return;
      const y = e.touches[0].clientY;
      this.target += (touchY - y) * 0.0007;
      touchY = y;
    };
    this._key = (e) => {
      if (!this.enabled) return;
      const step = { ArrowDown: 0.04, PageDown: 0.12, ' ': 0.12, ArrowUp: -0.04, PageUp: -0.12 }[e.key];
      if (step) this.target += step;
      if (e.key === 'Home') this.target = 0;
      if (e.key === 'End') this.target = 1;
    };
    target.addEventListener('wheel', this._wheel, { passive: false });
    target.addEventListener('touchstart', this._touchStart, { passive: true });
    target.addEventListener('touchmove', this._touchMove, { passive: true });
    target.addEventListener('keydown', this._key);
  }

  update(dt) {
    this.target = Math.min(Math.max(this.target, 0), 1);
    const prev = this.current;
    this.current += (this.target - this.current) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(this.target - this.current) < 1e-5) this.current = this.target;
    this.velocity = dt > 0 ? (this.current - prev) / dt : 0;
  }

  dispose() {
    this.el.removeEventListener('wheel', this._wheel);
    this.el.removeEventListener('touchstart', this._touchStart);
    this.el.removeEventListener('touchmove', this._touchMove);
    this.el.removeEventListener('keydown', this._key);
  }
}
