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
