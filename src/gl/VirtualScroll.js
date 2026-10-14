// Wheel / touch / keyboard driven progress with inertia. It is unbounded: the journey
// loops, so whole numbers all land on the start (see Experience.tick).

// Progress per pixel of wheel travel: one full loop is about 100 wheel notches.
const SPEED = 0.00008;
// How fast the view glides after the target (per second): lower is slower and floatier.
const FOLLOW = 1.8;

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
      this.target += Math.max(-120, Math.min(120, e.deltaY * unit)) * SPEED;
    };
    this._touchStart = (e) => { touchY = e.touches[0].clientY; };
    this._touchMove = (e) => {
      if (!this.enabled) return;
      const y = e.touches[0].clientY;
      this.target += (touchY - y) * SPEED * 3.5;
      touchY = y;
    };
    this._key = (e) => {
      if (!this.enabled) return;
      const step = { ArrowDown: 0.02, PageDown: 0.06, ' ': 0.06, ArrowUp: -0.02, PageUp: -0.06 }[e.key];
      if (step) this.target += step;
      if (e.key === 'Home') this.target = Math.round(this.target);
      if (e.key === 'End') this.target = Math.floor(this.target) + 0.93;
    };
    target.addEventListener('wheel', this._wheel, { passive: false });
    target.addEventListener('touchstart', this._touchStart, { passive: true });
    target.addEventListener('touchmove', this._touchMove, { passive: true });
    target.addEventListener('keydown', this._key);
  }

  update(dt) {
    const prev = this.current;
    this.current += (this.target - this.current) * (1 - Math.exp(-dt * FOLLOW));
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
