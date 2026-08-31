/* ============================================================
   Page scrolling, hero backdrop and pointer effects — the only JavaScript
   on the page. It smooths wheel and anchor scrolling, builds the backdrop's
   vertical loop, keeps each horizontal marquee track wide enough for a
   seamless loop, then feeds the real pointer position to three things:
     .hero__glow     the cursor light  (heaviest lag, smears when moving)
     .cursor__trail  ghosts bridging the gap between cursor and light
     .hero__cursor   the emitter — aura lags slightly, filament is exact
   How they *look* stays entirely in CSS.
   ============================================================ */
(() => {
  'use strict';

  const hero = document.querySelector('.hero');
  if (!hero) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ---- smooth page scrolling ---------------------------------------
     Wheel input updates a destination; one small RAF loop eases the page
     towards it. Touch, keyboard and reduced-motion scrolling stay native. */
  let smoothY = window.scrollY;
  let smoothTargetY = smoothY;
  let smoothFrame = 0;

  const maxScrollY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const clampScrollY = (value) => Math.min(maxScrollY(), Math.max(0, value));

  const smoothStep = () => {
    const distance = smoothTargetY - smoothY;
    smoothY += distance * 0.14;

    if (Math.abs(distance) < 0.5) {
      smoothY = smoothTargetY;
      smoothFrame = 0;
    } else {
      smoothFrame = requestAnimationFrame(smoothStep);
    }

    window.scrollTo(0, smoothY);
  };

  const smoothTo = (nextY) => {
    smoothTargetY = clampScrollY(nextY);
    if (smoothFrame) return;
    smoothY = window.scrollY;
    smoothFrame = requestAnimationFrame(smoothStep);
  };

  const cancelSmoothScroll = () => {
    if (smoothFrame) cancelAnimationFrame(smoothFrame);
    smoothFrame = 0;
    smoothY = smoothTargetY = window.scrollY;
  };

  window.addEventListener('wheel', (event) => {
    if (reduced.matches || !finePointer.matches || event.ctrlKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;

    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    smoothTo(smoothTargetY + event.deltaY * unit);
  }, { passive: false });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || reduced.matches) return;

    const id = decodeURIComponent(link.hash.slice(1));
    const destination = id ? document.getElementById(id) : document.documentElement;
    if (!destination) return;

    event.preventDefault();
    const margin = Number.parseFloat(getComputedStyle(destination).scrollMarginTop) || 0;
    smoothTo(window.scrollY + destination.getBoundingClientRect().top - margin);
    if (window.location.hash !== link.hash) history.pushState(null, '', link.hash);
  });

  window.addEventListener('scroll', () => {
    if (!smoothFrame) smoothY = smoothTargetY = window.scrollY;
  }, { passive: true });
  window.addEventListener('pointerdown', cancelSmoothScroll, { passive: true });
  window.addEventListener('resize', () => {
    smoothTargetY = clampScrollY(smoothTargetY);
  }, { passive: true });
  reduced.addEventListener('change', cancelSmoothScroll);

  /* ---- vertical backdrop flow ---------------------------------------
     A second identical row set sits directly above the source set. Moving
     the two-set strip down by one viewport makes new rows enter at the top;
     the identical endpoints let it reset without revealing the loop. */
  const backdrop = hero.querySelector('.hero__bg');
  const backdropFlow = backdrop && backdrop.querySelector('.hero__bg-flow');
  const backdropSet = backdropFlow && backdropFlow.querySelector('.hero__bg-set');

  if (backdrop && backdropFlow && backdropSet && backdropFlow.children.length === 1) {
    const leadingSet = backdropSet.cloneNode(true);
    leadingSet.setAttribute('aria-hidden', 'true');
    backdropFlow.prepend(leadingSet);
    backdrop.classList.add('hero__bg--flowing');
  }

  /* Tie the vertical loop directly to document scroll at quarter speed. Positive
     scroll moves the rows down; negative scroll moves them up. Normalising by
     one complete set lets either edge wrap without a jump. */
  let backdropFrame = 0;
  const BACKDROP_SCROLL_RATIO = 0.25;
  const syncBackdropFlow = () => {
    backdropFrame = 0;
    if (!backdropFlow || !backdropSet) return;

    if (reduced.matches) {
      backdropFlow.style.removeProperty('translate');
      return;
    }

    const setHeight = backdropSet.offsetHeight;
    if (!setHeight) return;

    const scrollDistance = window.scrollY * BACKDROP_SCROLL_RATIO;
    const phase = ((scrollDistance % setHeight) + setHeight) % setHeight;
    backdropFlow.style.translate = `0 ${phase - setHeight}px`;
  };

  const queueBackdropSync = () => {
    if (backdropFrame) return;
    backdropFrame = requestAnimationFrame(syncBackdropFlow);
  };

  queueBackdropSync();
  window.addEventListener('scroll', queueBackdropSync, { passive: true });
  window.addEventListener('resize', queueBackdropSync, { passive: true });
  reduced.addEventListener('change', queueBackdropSync);

  /* ---- marquee coverage ---------------------------------------------
     Two equal tracks loop cleanly only when either one can cover the visible
     row by itself. Repeat each verified base sequence in whole cycles until
     it does, then lengthen the duration by the same factor so its speed does
     not jump on wide screens. */
  const marqueeStates = [...hero.querySelectorAll('.marquee')].map((marquee) => {
    const inner = marquee.querySelector('.marquee__inner');
    const tracks = inner ? [...inner.querySelectorAll('.marquee__track')] : [];
    if (!inner || tracks.length !== 2) return null;

    const templates = [...tracks[0].children].map((item) => item.cloneNode(true));
    const baseDuration = Number.parseFloat(getComputedStyle(inner).animationDuration) || 44;
    return { marquee, inner, tracks, templates, baseDuration, cycles: 1 };
  }).filter(Boolean);

  const fillMarquees = () => {
    if (reduced.matches) return;

    for (const state of marqueeStates) {
      const gap = Number.parseFloat(getComputedStyle(state.tracks[0]).gap) || 0;
      const targetWidth = state.marquee.clientWidth + gap * 2;

      while (state.tracks[0].offsetWidth < targetWidth && state.cycles < 16) {
        for (const track of state.tracks) {
          for (const template of state.templates) track.appendChild(template.cloneNode(true));
        }
        state.cycles += 1;
      }

      state.inner.style.animationDuration = `${state.baseDuration * state.cycles}s`;
    }
  };

  let marqueeFrame = 0;
  const queueMarqueeFill = () => {
    if (marqueeFrame) return;
    marqueeFrame = requestAnimationFrame(() => {
      marqueeFrame = 0;
      fillMarquees();
    });
  };

  queueMarqueeFill();
  window.addEventListener('resize', queueMarqueeFill, { passive: true });
  reduced.addEventListener('change', queueMarqueeFill);
  if (document.fonts) document.fonts.ready.then(queueMarqueeFill);

  const glow   = hero.querySelector('.hero__glow');
  const cursor = hero.querySelector('.hero__cursor');
  const ring   = cursor && cursor.querySelector('.cursor__ring');
  const dot    = cursor && cursor.querySelector('.cursor__dot');
  if (!glow && !cursor) return;

  // needs a real pointer — no cursor to replace on touch
  if (!finePointer.matches) return;

  // only hide the system cursor once we know we can draw a replacement,
  // so a script failure never leaves the hero with no cursor at all
  if (cursor) hero.classList.add('hero--custom-cursor');

  /* ---- trail ---------------------------------------------------------
     The lag between cursor and light used to read as latency. These ghosts
     fill that gap. They form a chain — each link pulls toward the link ahead
     of it — so the tail bends along the path travelled instead of every node
     racing the pointer on its own. Fade and size ease out along the chain.  */
  const TRAIL = 9;
  const trail = [];

  if (cursor) {
    for (let i = 0; i < TRAIL; i++) {
      const el = document.createElement('span');
      el.className = 'cursor__trail';
      const t = (i + 1) / TRAIL;                 // 0 → nearest, 1 → furthest
      // ease out both fade and size so the tail thins away instead of
      // stopping at a visible last link
      el.style.opacity = String(0.46 * Math.pow(1 - t, 1.5) + 0.04);
      trail.push({
        el,
        ease: 0.34,                              // one stiffness for every link
        scale: 1 - Math.pow(t, 0.85) * 0.66,
        x: 0, y: 0
      });
      cursor.appendChild(el);
    }
  }

  let clientX = 0, clientY = 0;     // viewport space
  let targetX = 0, targetY = 0;     // hero space
  let glowX = 0, glowY = 0;
  let ringX = 0, ringY = 0;
  let frame = 0;
  let placed = false;
  let active = false;

  const move = (el, x, y, extra) =>
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)${extra || ''}`;

  // where the hero sat at the last measurement, in viewport space
  let heroLeft = 0, heroTop = 0;

  const measure = () => {
    const rect = hero.getBoundingClientRect();   // one read per frame
    heroLeft = rect.left;
    heroTop  = rect.top;
    targetX = clientX - rect.left;
    targetY = clientY - rect.top;
  };

  /* Everything is stored in hero space, but the pointer lives in viewport
     space. Scrolling moves the hero under a stationary pointer, so those
     coordinates silently stop matching and the light drifts off the cursor.
     No pointermove fires, so nothing corrects it. Shift every stored
     position by however far the hero travelled and the whole assembly stays
     glued to the pointer — no sweeping back, since the pointer never moved. */
  const reanchor = () => {
    if (!placed) return;

    const rect = hero.getBoundingClientRect();
    const dx = heroLeft - rect.left;
    const dy = heroTop  - rect.top;

    if (dx || dy) {
      glowX += dx; glowY += dy;
      ringX += dx; ringY += dy;
      for (const node of trail) { node.x += dx; node.y += dy; }
    }

    heroLeft = rect.left;
    heroTop  = rect.top;
    targetX = clientX - rect.left;
    targetY = clientY - rect.top;

    if (dot)  move(dot, targetX, targetY);
    if (glow) move(glow, glowX, glowY);
    if (ring) move(ring, ringX, ringY);
    for (const node of trail) move(node.el, node.x, node.y, ` scale(${node.scale})`);
  };

  // scroll fires far faster than we can paint — collapse to one per frame
  let anchorQueued = false;
  const onViewportChange = () => {
    if (anchorQueued) return;
    anchorQueued = true;
    requestAnimationFrame(() => { anchorQueued = false; reanchor(); });
  };

  const tick = () => {
    measure();

    // different lag per element is what sells it: the light drags well
    // behind, the ring follows closely, the filament is already exact
    const glowEase = reduced.matches ? 1 : 0.14;
    const ringEase = reduced.matches ? 1 : 0.26;

    // gap between the light and the pointer doubles as a velocity vector —
    // stretch the light along it so fast moves smear instead of sliding
    const dx = targetX - glowX;
    const dy = targetY - glowY;
    const speed = Math.hypot(dx, dy);
    const stretch = reduced.matches ? 0 : Math.min(speed / 900, 0.42);
    const angle = Math.atan2(dy, dx);

    glowX += dx * glowEase;
    glowY += dy * glowEase;
    ringX += (targetX - ringX) * ringEase;
    ringY += (targetY - ringY) * ringEase;

    if (glow) {
      // rotate → scale → UNrotate. That composes to a pure stretch along the
      // direction of travel while leaving the blob's own orientation alone.
      // Rotating without undoing it makes the shape spin on its axis whenever
      // the pointer moves in a circle, which is not what motion blur does.
      move(glow, glowX, glowY,
        ` rotate(${angle}rad) scale(${1 + stretch}, ${1 - stretch * 0.5}) rotate(${-angle}rad)`);
    }
    if (ring) move(ring, ringX, ringY);

    // Each ghost follows the one AHEAD of it, not the pointer. Chasing the
    // pointer independently makes them cut across the inside of a curve and
    // bunch up; chained, they lay out along the path actually travelled.
    let tailSettled = true;
    let leadX = ringX, leadY = ringY;
    for (const node of trail) {
      const ease = reduced.matches ? 1 : node.ease;
      const gx = leadX - node.x;
      const gy = leadY - node.y;
      node.x += gx * ease;
      node.y += gy * ease;
      move(node.el, node.x, node.y, ` scale(${node.scale})`);
      if (Math.abs(gx) > 0.4 || Math.abs(gy) > 0.4) tailSettled = false;
      leadX = node.x;
      leadY = node.y;
    }

    const settled = tailSettled &&
      Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 &&
      Math.abs(targetX - ringX) < 0.4 && Math.abs(targetY - ringY) < 0.4;

    frame = settled ? 0 : requestAnimationFrame(tick);
  };

  const snap = () => {
    measure();
    glowX = ringX = targetX;
    glowY = ringY = targetY;
    if (glow) move(glow, glowX, glowY);
    if (ring) move(ring, ringX, ringY);
    for (const node of trail) {
      node.x = targetX;
      node.y = targetY;
      move(node.el, node.x, node.y, ` scale(${node.scale})`);
    }
  };

  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;

    clientX = event.clientX;
    clientY = event.clientY;
    measure();

    // the filament never lags — it *is* the pointer
    if (dot) move(dot, targetX, targetY);

    // entering: jump into place rather than sweeping in from the last spot
    if (!placed) {
      snap();
      placed = true;
      if (cursor) cursor.classList.add('is-visible');
      return;
    }

    // grow the source over anything clickable
    const overLink = !!event.target.closest('a, button, input, label, summary');
    if (overLink !== active) {
      active = overLink;
      if (cursor) cursor.classList.toggle('is-active', active);
    }

    if (!frame) frame = requestAnimationFrame(tick);
  }, { passive: true });

  hero.addEventListener('pointerleave', () => {
    placed = false;
    if (cursor) cursor.classList.remove('is-visible', 'is-active');
    active = false;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
  }, { passive: true });

  window.addEventListener('scroll', onViewportChange, { passive: true });
  window.addEventListener('resize', onViewportChange, { passive: true });

  // pressing gives the source a bit of feedback
  hero.addEventListener('pointerdown', () => cursor && cursor.classList.add('is-down'), { passive: true });
  window.addEventListener('pointerup',  () => cursor && cursor.classList.remove('is-down'), { passive: true });
})();
