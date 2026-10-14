<script>
  import { onMount } from 'svelte';
  import gsap from 'gsap';
  import { Experience, CUBE_RANGE } from './gl/Experience.js';
  import { sound } from './audio/Sound.js';
  import { progress, cubeScreen, hoverCube, project, domeLabels, ringLabels } from './state.js';
  import { scramble } from './lib/scramble.js';
  import { SECTIONS, VENTURES, MANIFESTO } from './content.js';

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
  let clock = '';

  $: p = $progress;
  $: active = SECTIONS.findIndex((s) => p >= s.range[0] && p <= s.range[1]);
  $: inCubes = started && $project < 0 && p >= CUBE_RANGE[0] && p <= CUBE_RANGE[1];
  $: showHint = started && p < 0.02;

  const pad = (n, l = 3) => String(Math.round(n)).padStart(l, '0');

  onMount(() => {
    exp = new Experience(canvas);
    exp.onCubeClick = openProject;

    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    gsap.to(load, {
      pct: 100,
      duration: 2.4,
      ease: 'power2.inOut',
      onUpdate: () => (pct = load.pct),
      onComplete: () => fonts.then(() => (ready = true)),
    });

    let raf;
    const loop = () => {
      cursorLerp.x += (cursor.x - cursorLerp.x) * 0.2;
      cursorLerp.y += (cursor.y - cursorLerp.y) * 0.2;
      if (cursorEl) cursorEl.style.transform = `translate(${cursorLerp.x}px,${cursorLerp.y}px)`;
      const d = new Date();
      const c = `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)} UTC`;
      if (c !== clock) clock = c;
      raf = requestAnimationFrame(loop);
    };
    loop();
    const move = (e) => (cursor = { x: e.clientX, y: e.clientY });
    const key = (e) => e.key === 'Escape' && $project >= 0 && closeProject();
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

  function jump(s) {
    sound.click();
    exp.goTo(s.jump);
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

  function selectFromLabel(i) {
    sound.click();
    openProject(i);
  }
</script>

<canvas bind:this={canvas} class="gl"></canvas>

<!-- ======================= LOADER ======================= -->
{#if !started}
  <div class="loader" class:out={leaving}>
    <div class="loader-inner">
      <div class="loader-top">
        <span>FROST // SYSTEM BOOT</span>
        <span>{pad(pct)}%</span>
      </div>
      <h1 class="loader-logo frost">
        {#each 'FROST'.split('') as ch, i}
          <span style="opacity:{Math.min(1, Math.max(0, pct / 20 - i))}">{ch}</span>
        {/each}
      </h1>
      <div class="bar"><div style="transform:scaleX({pct / 100})"></div></div>
      <div class="loader-actions" class:show={ready}>
        <button class="btn" on:click={() => enter(true)} on:mouseenter={() => sound.hover()}>
          [ ENTER WITH SOUND ]
        </button>
        <button class="btn ghost" on:click={() => enter(false)}>enter in silence</button>
      </div>
      <p class="loader-note">Headphones recommended. Scroll to move through the cold.</p>
    </div>
  </div>
{/if}

<!-- ======================= HUD ======================= -->
<div class="hud" class:show={started}>
  <header>
    <button class="logo" on:click={() => jump(SECTIONS[0])}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 1v22M2.5 6.5l19 11M2.5 17.5l19-11M12 5l-2.5-2.5M12 5l2.5-2.5M12 19l-2.5 2.5M12 19l2.5 2.5" stroke="currentColor" fill="none" stroke-width="1.4" />
      </svg>
      FROST
    </button>
    <div class="meta">
      <span>LAT 78.2232° N</span>
      <span>{clock}</span>
    </div>
    <button class="sound" class:on={soundOn} on:click={toggleSound} aria-label="Toggle sound">
      <span class="bars"><i></i><i></i><i></i><i></i></span>
      SOUND {soundOn ? 'ON' : 'OFF'}
    </button>
  </header>

  <nav class="rail">
    {#each SECTIONS as s, i}
      <button class:active={active === i} on:click={() => jump(s)} on:mouseenter={() => sound.hover()}>
        <span class="lbl">{s.label}</span>
      </button>
    {/each}
  </nav>

  <div class="progress">
    <span>{pad(p * 100)}</span>
    <div class="track"><div style="transform:scaleY({p})"></div></div>
    <span>100</span>
  </div>

  <div class="hint" class:show={showHint}>
    <span>SCROLL</span>
    <i></i>
  </div>
</div>

<!-- ======================= SECTIONS ======================= -->
{#if started}
  <section class="sec hero" class:on={active === 0}>
    <p class="kicker" use:scramble={{ active: active === 0, delay: 3200 }}>/// FROST</p>
    <h2 class="frost" use:scramble={{ active: active === 0, delay: 3500, speed: 0.8 }}>Built for the long winter.</h2>
    <p class="sub" use:scramble={{ active: active === 0, delay: 3900, speed: 2, beep: false }}>
      A holding company for durable systems and the communities that live inside them.
    </p>
    <p class="probe">[ HOVER THE IGLOO ]</p>
  </section>

  {#each $domeLabels as l (l.id)}
    <div class="measure" style="left:{l.x}px;top:{l.y}px">
      <span class="id">{l.id}</span>
      <span class="val">Δ <b>{l.d}</b> M</span>
    </div>
  {/each}

  <section class="sec right" class:on={active === 1}>
    <p class="kicker" use:scramble={{ active: active === 1 }}>// STRUCTURE</p>
    <h2 class="frost" use:scramble={{ active: active === 1, delay: 150 }}>Every block carries weight.</h2>
    <p class="sub" use:scramble={{ active: active === 1, delay: 400, speed: 2.5, beep: false }}>
      Break the shell apart and the light inside keeps burning. Each piece we build is designed to stand on its own and stronger together.
    </p>
  </section>

  <section class="sec center" class:on={active === 2}>
    <p class="kicker" use:scramble={{ active: active === 2 }}>// PASSAGE</p>
    <h2 class="frost" use:scramble={{ active: active === 2, delay: 150 }}>Through the halos.</h2>
    <p class="sub" use:scramble={{ active: active === 2, delay: 400, speed: 2.5, beep: false }}>
      Three rings, six arms each. Fragments in orbit — nothing here is lost, it is only waiting to be reassembled.
    </p>
  </section>

  {#each $ringLabels as r (r.id)}
    <div class="halo" class:show={r.visible} class:pulse={r.pulse} style="left:{r.x}px;top:{r.y}px">
      <span class="id"><i></i>{r.id}</span>
      <span>Ø <b>{r.diam}</b> M</span>
      <span>DIST <b>{r.dist}</b> M</span>
      {#if r.gap}<span>GAP → <b>{r.gap}</b> M</span>{/if}
    </div>
  {/each}

  <section class="sec top" class:on={active === 3 && $project < 0}>
    <p class="kicker" use:scramble={{ active: active === 3 && $project < 0 }}>// VENTURES</p>
    <h2 class="frost" use:scramble={{ active: active === 3 && $project < 0, delay: 150 }}>Frozen in motion.</h2>
  </section>

  {#each $cubeScreen as pos, i}
    <button
      class="cube-label"
      class:show={inCubes}
      class:hover={$hoverCube === i}
      style="left:{pos.x}px;top:{pos.y}px"
      on:click={() => selectFromLabel(i)}
    >
      <span class="code">{VENTURES[i].code}</span>
      <span class="name">{VENTURES[i].name}</span>
      <span class="cta">{$hoverCube === i ? '[ OPEN ]' : VENTURES[i].tag}</span>
    </button>
  {/each}

  <section class="sec manifesto" class:on={active === 4}>
    <p class="kicker" use:scramble={{ active: active === 4 }}>// MANIFESTO</p>
    {#each MANIFESTO as line, i}
      <p class="m-line" use:scramble={{ active: active === 4, delay: 300 + i * 700, speed: 2.2, beep: i === 0 }}>{line}</p>
    {/each}
    <footer>
      <span>// Copyright © 2026</span>
      <span>FROST. All rights reserved.</span>
      <span class="links"><a href="#top" on:click|preventDefault={() => jump(SECTIONS[0])}>Back to origin ↑</a></span>
    </footer>
  </section>
{/if}

<!-- ======================= PROJECT PANEL ======================= -->
{#if $project >= 0}
  {@const v = VENTURES[$project]}
  <aside class="panel">
    <button class="close" on:click={closeProject} on:mouseenter={() => sound.hover()}>[ X ] CLOSE</button>
    <p class="kicker" use:scramble={{ active: true, delay: 500 }}>{v.code} // {v.tag}</p>
    <h3 class="frost" use:scramble={{ active: true, delay: 700, speed: 0.7 }}>{v.name}</h3>
    <p class="kicker dim" use:scramble={{ active: true, delay: 900, beep: false }}>////// Summary</p>
    <p class="body" use:scramble={{ active: true, delay: 1000, speed: 5, beep: false }}>{v.summary}</p>
    <dl>
      {#each v.meta as [k, val]}
        <div><dt>{k}</dt><dd>{val}</dd></div>
      {/each}
    </dl>
  </aside>
{/if}

<div class="cursor" bind:this={cursorEl} class:big={$hoverCube >= 0 || $domeLabels.length > 0}></div>
