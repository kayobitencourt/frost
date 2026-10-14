import { sound } from '../audio/Sound.js';

const GLYPHS = '/\\|_-=+*<>[]{}#%0123456789ABCDEFXZ';

// Svelte action: decodes the node's text from random glyphs whenever `active` turns true.
export function scramble(node, { active = false, delay = 0, speed = 1, beep = true } = {}) {
  const original = node.textContent;
  let raf = 0;
  let timer = 0;
  let was = false;

  const run = () => {
    cancelAnimationFrame(raf);
    const start = performance.now();
    const chars = [...original];
    const span = chars.length * 14 * (1 / speed) + 250;
    if (beep) sound.beeps(Math.min(10, 3 + Math.floor(chars.length / 12)));
    const frame = (now) => {
      const el = now - start;
      let out = '';
      let done = true;
      for (let i = 0; i < chars.length; i++) {
        const revealAt = (i / chars.length) * span;
        if (chars[i] === ' ' || chars[i] === '\n' || el > revealAt + 120) out += chars[i];
        else if (el > revealAt) {
          out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
          done = false;
        } else {
          out += i < chars.length && el > revealAt - 200 ? '_' : ' ';
          done = false;
        }
      }
      node.textContent = out;
      if (!done) raf = requestAnimationFrame(frame);
      else node.dispatchEvent(new CustomEvent('decoded'));
    };
    raf = requestAnimationFrame(frame);
  };

  const apply = (opts) => {
    ({ active = false, delay = 0, speed = 1, beep = true } = opts);
    clearTimeout(timer);
    if (active && !was) timer = setTimeout(run, delay);
    if (!active && was) {
      cancelAnimationFrame(raf);
      node.textContent = ' ';
    }
    was = active;
  };

  node.textContent = ' ';
  apply({ active, delay, speed, beep });

  return {
    update: apply,
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    },
  };
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Svelte action: once the text has decoded, words near the cursor turn bold and the
// ones right under it jumble into random letters for a moment, like a reading lens.
export function lens(node, { radius = 110, core = 34 } = {}) {
  let words = [];
  const wrap = () => {
    const text = node.textContent;
    node.textContent = '';
    words = [];
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        node.append(part);
        continue;
      }
      const w = document.createElement('span');
      w.className = 'w';
      w.textContent = part;
      w.dataset.t = part;
      node.append(w);
      words.push(w);
    }
  };
  const jumble = (w) => {
    w.busy = true;
    const t = w.dataset.t;
    let n = 0;
    const id = setInterval(() => {
      n++;
      w.textContent = [...t].map((c) => (/\w/.test(c) && Math.random() < 0.6 - n * 0.09 ? LETTERS[(Math.random() * LETTERS.length) | 0] : c)).join('');
      if (n > 6) {
        clearInterval(id);
        w.textContent = t;
        w.busy = false;
      }
    }, 45);
    sound.tick();
  };
  const move = (e) => {
    for (const w of words) {
      const r = w.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), (e.clientY - (r.top + r.height / 2)) * 1.8);
      w.classList.toggle('lit', d < radius);
      if (d < core && !w.busy) jumble(w);
    }
  };
  const leave = () => words.forEach((w) => w.classList.remove('lit'));
  node.addEventListener('decoded', wrap);
  window.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', leave);
  return {
    destroy() {
      node.removeEventListener('decoded', wrap);
      window.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
    },
  };
}
