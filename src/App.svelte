<script>
  import { onMount } from 'svelte';
  import gsap from 'gsap';
  import { Experience } from './gl/Experience.js';
  import { sound } from './audio/Sound.js';
  import { progress, sceneIndex, project, domeLabels, callouts, hoverCrystal, linkIndex } from './state.js';
  import { scramble } from './lib/scramble.js';
  import { VENTURES, LINKS, MISSION, GHOST_ROWS } from './content.js';

  let canvas;
  let exp;
  let load = { pct: 0 };
  let pct = 0;
  let ready = false;
  let started = false;
  let leaving = false;
  let soundOn = false;
  let cursor = { x: -100, y: -100 };
  const cursorLerp = { x: -100, y: -100 };
  let cursorEl;
  let vw = 1600;
  let temps = VENTURES.map(() => ({ t: 32 + Math.random() * 4, d: Math.random() * 0.2 }));

  $: scene = $sceneIndex;
  $: inHero = started && scene === 0 && $progress < 0.06;
  $: ghosts = started && (scene === 1 || scene === 3) && $project < 0;
  $: L = LINKS.length;
  $: prev = LINKS[($linkIndex + L - 1) % L];
  $: next = LINKS[($linkIndex + 1) % L];
  // narrow screens: shorter leaders and no side readout
  $: narrow = vw < 720;
  $: shownCallouts = narrow ? $callouts.filter((c) => c.side !== 'r') : $callouts;

  const pad = (n, l = 3) => String(Math.round(n)).padStart(l, '0');
  const stage = (v) => v.meta.find(([k]) => k === 'Stage')[1];

  onMount(() => {
    exp = new Experience(canvas);
    exp.onCrystalClick = openProject;

    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    gsap.to(load, {
      pct: 100,
      duration: 2.4,
      ease: 'power2.inOut',
      onUpdate: () => (pct = load.pct),
      onComplete: () => fonts.then(() => (ready = true)),
    });

    let raf;
    let lastTemp = 0;
    const loop = (now) => {
      cursorLerp.x += (cursor.x - cursorLerp.x) * 0.2;
      cursorLerp.y += (cursor.y - cursorLerp.y) * 0.2;
      if (cursorEl) cursorEl.style.transform = `translate(${cursorLerp.x}px,${cursorLerp.y}px)`;
      if (now - lastTemp > 120) {
        lastTemp = now;
        temps = temps.map((x) => ({ t: x.t + (Math.random() - 0.5) * 0.08, d: Math.abs(x.d + (Math.random() - 0.5) * 0.02) }));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const move = (e) => (cursor = { x: e.clientX, y: e.clientY });
    const key = (e) => {
      if (e.key === 'Escape' && $project >= 0) closeProject();
      if ($sceneIndex === 3 && e.key === 'ArrowLeft') step(-1);
      if ($sceneIndex === 3 && e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('keydown', key);
      exp.dispose();
    };
  });

  function enter(withSound) {
    if (leaving) return;
    leaving = true;
    if (withSound) {
      sound.start();
      soundOn = true;
      sound.click();
      sound.logo();
    }
    setTimeout(() => {
      started = true;
      exp.start();
    }, 600);
  }

  function toggleSound() {
    if (!sound.ctx) {
      sound.start();
      soundOn = true;
    } else {
      soundOn = !soundOn;
      sound.setEnabled(soundOn);
    }
    sound.click();
  }

  function step(dir) {
    sound.click();
    linkIndex.update((i) => (i + dir + L) % L);
  }

  function openProject(i) {
    project.set(i);
    sound.enter();
    exp.setFocus(i);
  }

  function closeProject() {
    project.set(-1);
    sound.leave();
    exp.setFocus(-1);
  }

  // Callout leader: anchor on the crystal -> elbow -> underline the label sits on.
  const LEAD = {
    tl: { dx: -70, dy: -60, len: -150 },
    r: { dx: 60, dy: -36, len: 90 },
    br: { dx: 70, dy: 50, len: 130 },
  };
  function leader(c) {
    const k = narrow ? 0.45 : 1;
    const l = LEAD[c.side];
    const ex = c.x + l.dx * k;
    const ey = c.y + l.dy * k;
    const end = ex + l.len * k;
    return { ex, ey, end, pts: `${c.x},${c.y} ${ex},${ey} ${end},${ey}` };
  }
</script>

<svelte:window bind:innerWidth={vw} />
<canvas bind:this={canvas} class="gl"></canvas>

<!-- ======================= LOADER ======================= -->
{#if !started}
  <div class="loader" class:out={leaving}>
    <div class="loader-inner">
      <div class="loader-top">
        <span>// FROST SYSTEM BOOT</span>
        <span>{pad(pct)}%</span>
      </div>
      <h1 class="loader-logo">
        {#each 'FROST'.split('') as ch, i}
          <span style="opacity:{Math.min(1, Math.max(0, pct / 20 - i))}">{ch}</span>
        {/each}
      </h1>
      <div class="bar"><div style="transform:scaleX({pct / 100})"></div></div>
      <div class="loader-actions" class:show={ready}>
        <button class="btn" on:click={() => enter(true)} on:mouseenter={() => sound.hover()}>[ Enter with sound ]</button>
        <button class="btn ghost" on:click={() => enter(false)}>enter in silence</button>
      </div>
      <p class="loader-note">Headphones recommended. Scroll to move through the cold.</p>
    </div>
  </div>
{/if}

<!-- ======================= GHOST TELEMETRY ======================= -->
<div class="ghosts" class:show={ghosts} style="transform:translateY({-($progress * 900) % 400}px)">
  {#each GHOST_ROWS as row, i}
    <p style="left:{[4, 58, 10, 62, 2, 55][i]}vw;top:{14 + i * 15}vh">{row}</p>
  {/each}
</div>

<!-- ======================= HUD ======================= -->
<div class="hud" class:show={started}>
  <div class="brand">
    <button class="logo" on:click={() => exp.goTo(0)} aria-label="Back to start">FROST</button>
    <div class="legal" class:on={inHero}>
      <p use:scramble={{ active: inHero, delay: 300, beep: false }}>// Copyright © 2026</p>
      <p use:scramble={{ active: inHero, delay: 450, beep: false }}>FROST, Inc.</p>
      <p use:scramble={{ active: inHero, delay: 550, beep: false }}>All Rights Reserved.</p>
    </div>
  </div>

  <div class="manifesto" class:on={inHero}>
    <p class="m-title" use:scramble={{ active: inHero, delay: 600 }}>////// Manifesto</p>
    <p class="m-body" use:scramble={{ active: inHero, delay: 800, speed: 2, beep: false }}>{MISSION}</p>
  </div>

  <button class="sound" class:on={soundOn} on:click={toggleSound} aria-label="Toggle sound">
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
      {#if soundOn}<path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" fill="none" stroke-width="1.2" />{/if}
    </svg>
    Sound: {soundOn ? 'On' : 'Off'}
  </button>
</div>

{#if started}
  <!-- igloo: measured bricks -->
  {#each $domeLabels as l (l.id)}
    <div class="measure" style="left:{l.x}px;top:{l.y}px">{l.d}</div>
    <div class="measure base" style="left:{l.ax}px;top:{l.ay}px">{pad((l.id * 7) % 100, 2)}</div>
  {/each}

  <!-- crystals: HUD callouts -->
  {#if shownCallouts.length}
    <svg class="leaders" aria-hidden="true">
      {#each shownCallouts as c (c.key)}
        <polyline points={leader(c).pts} />
        <circle cx={c.x} cy={c.y} r="2.2" />
      {/each}
    </svg>
  {/if}
  {#each shownCallouts as c (c.key)}
    {@const l = leader(c)}
    {@const v = VENTURES[c.crystal]}
    <div class="callout {c.side}" style="left:{c.side === 'tl' ? l.end : l.ex}px;top:{l.ey}px">
      {#if c.side === 'tl'}
        <p use:scramble={{ active: true, delay: 80 }}>{v.code}</p>
        <p use:scramble={{ active: true, delay: 200, beep: false }}>{v.name.toUpperCase()}</p>
      {:else if c.side === 'r'}
        <p>TEMP <b>-{temps[c.crystal].t.toFixed(2)}</b></p>
        <p>+{temps[c.crystal].d.toFixed(2)}</p>
      {:else}
        <p use:scramble={{ active: true, delay: 260, beep: false }}>STAGE {stage(v).toUpperCase()}</p>
        <p use:scramble={{ active: true, delay: 340, beep: false }}>{v.tag.toUpperCase()}</p>
      {/if}
    </div>
  {/each}

  <!-- platform: link carousel -->
  <div class="links" class:on={scene === 3 && $progress > 0.9}>
    <button class="arrow left" on:click={() => step(-1)} on:mouseenter={() => sound.hover()} aria-label="Previous link">
      <svg viewBox="0 0 60 12" width="60" height="12"><path d="M60 6H1M7 1L1 6l6 5" stroke="currentColor" fill="none" /></svg>
    </button>
    <button class="arrow right" on:click={() => step(1)} on:mouseenter={() => sound.hover()} aria-label="Next link">
      <svg viewBox="0 0 60 12" width="60" height="12"><path d="M0 6h59M53 1l6 5-6 5" stroke="currentColor" fill="none" /></svg>
    </button>
    <div class="carousel">
      <button class="side" on:click={() => step(-1)}>{#key $linkIndex}<span use:scramble={{ active: true, beep: false }}>{prev.label}</span>{/key}</button>
      <a class="current" href={LINKS[$linkIndex].href} target="_blank" rel="noopener" on:mouseenter={() => sound.hover()}>
        <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
        {#key $linkIndex}<span use:scramble={{ active: true, beep: false }}>{LINKS[$linkIndex].label}</span>{/key}
      </a>
      <button class="side" on:click={() => step(1)}>{#key $linkIndex}<span use:scramble={{ active: true, beep: false }}>{next.label}</span>{/key}</button>
    </div>
  </div>
{/if}

<!-- ======================= PROJECT PANEL ======================= -->
{#if $project >= 0}
  {@const v = VENTURES[$project]}
  <aside class="panel">
    <button class="close" on:click={closeProject} on:mouseenter={() => sound.hover()}>[ X ] Close</button>
    <p class="kicker" use:scramble={{ active: true, delay: 500 }}>{v.code} // {v.tag}</p>
    <h3 use:scramble={{ active: true, delay: 700, speed: 0.7 }}>{v.name}</h3>
    <p class="kicker dim" use:scramble={{ active: true, delay: 900, beep: false }}>////// Summary</p>
    <p class="body" use:scramble={{ active: true, delay: 1000, speed: 5, beep: false }}>{v.summary}</p>
    <dl>
      {#each v.meta as [k, val]}
        <div><dt>{k}</dt><dd>{val}</dd></div>
      {/each}
    </dl>
  </aside>
{/if}

<div class="cursor" bind:this={cursorEl} class:big={$hoverCrystal >= 0 || $domeLabels.length > 0}>
  {#if $hoverCrystal >= 0 && $project < 0}<span>Open</span>{/if}
</div>
