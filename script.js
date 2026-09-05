/*
 * AI USAGE NOTE (Claude, Anthropic): I used Claude as a coding partner for
 * this whole site, most heavily for interaction mechanics I didn't know how
 * to build from scratch -- the damped-spring physics, the drag-to-navigate
 * tick system, and the CSS scroll-snap photo carousel below. I directed the
 * design decisions (what should be interactive, what to fix when something
 * looked/behaved wrong) and asked Claude to implement or adjust specific
 * mechanics, then had it explain how each piece works so I could tune the
 * actual numbers (spring stiffness/damping, pull distances, tick
 * thresholds) myself instead of just accepting the first version it wrote.
 * The full back-and-forth is in PROMPT_LOG.md in the repo root.
 */
(function(){
  "use strict";
  // this one file is linked from all four pages, so most of it is wrapped
  // in "if (someElement) { ... }" blocks below -- each block only runs on
  // the page that actually has that element (e.g. the HOME block only
  // does anything on index.html, since that's the only page with #grip).
  // that way one script.js works everywhere without throwing errors on
  // pages that don't have a particular feature.
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- SOUND: tiny synthesized UI sound effects ----------
     AI-suggested: instead of shipping actual audio files (licensing to
     track down, extra network requests, a bigger repo), every sound here
     is synthesized live with the Web Audio API -- a couple of oscillators
     shaped with gain/filter envelopes. Browsers won't let audio play until
     a real user gesture happens, which is naturally true here since every
     sound is triggered by an actual click or drag. */
  var audioCtx = null;
  var audioUnlocked = false;
  // returns the single shared AudioContext, creating it the first time it's
  // needed. An AudioContext is the object the Web Audio API uses to build
  // and play sound graphs (oscillator -> gain -> speakers, etc.) -- every
  // sound function below calls this first to get access to it. If the
  // browser doesn't support Web Audio at all, this just returns null and
  // the sound functions quietly do nothing.
  function getAudioCtx(){
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  // AI-diagnosed hardening: a fresh AudioContext can come back "suspended"
  // even when created inside a click handler, and resume() alone isn't
  // always enough (iOS Safari in particular needs an actual sound to be
  // started, not just resumed, during the gesture) -- so unlock explicitly
  // on the very first interaction of any kind, every page load, rather
  // than only ever trying inside the sound functions themselves.
  function unlockAudio(){
    if (audioUnlocked) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    audioUnlocked = true;
    try {
      var buffer = ctx.createBuffer(1, 1, 22050);
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {}
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(function(evt){
    document.addEventListener(evt, unlockAudio, { passive: true });
  });

  // a short, quiet blip for ordinary clicks (links, buttons, chart points).
  // What's happening: an "oscillator" node generates a steady 720Hz sine
  // wave (a pure, simple tone), and a "gain" node controls its volume over
  // time -- it ramps up from silent to 0.09 volume in 8ms, then back down
  // to silent by 100ms, which is what makes it sound like a short blip
  // instead of a flat beep that just cuts off. exponentialRampToValueAtTime
  // can't ramp to exactly 0 (it's a percentage-based curve), so 0.0001 is
  // used as "basically silent" instead. Connecting osc -> gain -> destination
  // is literally wiring the sound: oscillator generates it, gain shapes its
  // volume, destination is the speakers.
  function playClick(){
    var ctx = getAudioCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 720;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }

  // a quick downward "boing" for a plain click/pluck on the home name (not
  // a real drag -- see the "moved" check in pointerMove where this gets
  // called instead of the stretch tone). Same idea as playClick above, but
  // the oscillator's frequency also slides from 420Hz down to 140Hz over
  // 160ms while it plays, which is what gives it that dropping "boing"
  // character instead of a flat blip. "triangle" wave type just sounds a
  // little richer/rounder than the plain sine wave used for clicks.
  function playPluck(){
    var ctx = getAudioCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  }

  // the continuous "tension" tone that plays while actively dragging the
  // name -- unlike the two functions above, this one doesn't play a single
  // short sound and stop; it starts a tone that keeps running and gets
  // updated continuously as your finger/mouse moves, then gets stopped
  // once you let go. Three separate audio nodes are chained together:
  //   oscillator (the raw tone) -> filter (shapes its tone color) -> gain
  //   (its volume) -> speakers
  // stretchUpdate() is called on every pointermove with how far you've
  // pulled (0 to ~1.3) and pushes all three up together -- pitch, filter
  // brightness, and volume -- so it sounds like it's under more and more
  // tension the further you stretch, not just louder or just
  // higher-pitched on its own.
  var stretchOsc = null, stretchGain = null, stretchFilter = null;

  // starts the tension tone: builds the oscillator -> filter -> gain chain
  // described above and starts it playing at its quietest, lowest setting
  // (stretchUpdate immediately raises it from there as you keep pulling)
  function stretchStart(){
    var ctx = getAudioCtx();
    if (!ctx) return;
    stretchStop();
    stretchOsc = ctx.createOscillator();
    stretchOsc.type = 'triangle';
    stretchOsc.frequency.value = 90;
    stretchFilter = ctx.createBiquadFilter();
    stretchFilter.type = 'lowpass'; // a lowpass filter lets low tones through and dampens high ones -- turning its cutoff up makes the sound brighter/harsher
    stretchFilter.frequency.value = 250;
    stretchGain = ctx.createGain();
    stretchGain.gain.value = 0.0001;
    stretchOsc.connect(stretchFilter).connect(stretchGain).connect(ctx.destination);
    stretchOsc.start();
  }
  // called continuously while dragging -- frac is the current pull amount
  // (0 = just grabbed it, 1 = reached the last tick, can go a little past).
  // setTargetAtTime smoothly glides each value toward its new target over
  // ~30ms instead of jumping instantly, so it doesn't sound choppy even
  // though this runs on every single pointermove event.
  function stretchUpdate(frac){
    if (!stretchOsc) return;
    var ctx = getAudioCtx();
    var t = Math.max(0, Math.min(1.3, frac));
    stretchOsc.frequency.setTargetAtTime(90 + t * 260, ctx.currentTime, 0.03);
    stretchFilter.frequency.setTargetAtTime(250 + t * 2200, ctx.currentTime, 0.03);
    stretchGain.gain.setTargetAtTime(0.035 + t * 0.09, ctx.currentTime, 0.03);
  }
  // stops the tension tone when you let go -- fades the volume down over
  // 50ms first (so it doesn't cut off with an audible click), then
  // actually stops and disconnects the oscillator/gain nodes 300ms later
  // once the fade has finished, freeing them up for the next drag
  function stretchStop(){
    if (!stretchOsc) return;
    var ctx = getAudioCtx();
    var osc = stretchOsc, gain = stretchGain;
    stretchOsc = null; stretchGain = null; stretchFilter = null;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    setTimeout(function(){ try { osc.stop(); osc.disconnect(); gain.disconnect(); } catch (e) {} }, 300);
  }

  // one "delegated" listener on the whole document covers every
  // link/button/chart-point sitewide, instead of wiring a click sound onto
  // each element individually. e.target is whatever element was actually
  // clicked (which could be, say, the text inside a button rather than the
  // button itself) -- .closest('a, button, .pt') walks back up from there
  // to find the nearest link, button, or chart point, if any.
  document.addEventListener('click', function(e){
    var el = e.target.closest ? e.target.closest('a, button, .pt') : null;
    if (el) playClick();
  });

  /* ---------- HOME: pull the name to navigate ----------
     This whole block runs the homepage's main gimmick: instead of a normal
     nav bar, you click-and-drag (or touch-and-drag) my name sideways, and
     how far you pull decides which page you land on. Grabbing the element
     references up front like this is just so every function below can use
     them without re-querying the DOM every time. */
  var grip = document.getElementById('grip');
  if (grip) {
    var gripText = document.getElementById('gripText');   // the actual name text being stretched
    var heroGraph = document.getElementById('heroGraph');  // the stress-strain graph panel next to it
    var statusEl = document.getElementById('pullStatus');  // the small "stretch to explore" caption
    var tickEls = Array.prototype.slice.call(document.querySelectorAll('.tick')); // the dots/labels on the graph
    var IDLE_TEXT = statusEl ? statusEl.textContent : 'stretch to explore';
    // AI-suggested mechanic: map pull distance to destinations as fractions
    // of a max-pull distance computed per grab from window width (see
    // pointerDown below), instead of fixed pixel thresholds -- that way the
    // tick zones stay proportionally spaced on any screen size instead of
    // breaking on mobile where there's less room to drag.
    // how far (as a fraction of the full pull) before each page arms, in
    // ascending order of distance -- spaced well apart on purpose so it's
    // easy to stop in the zone you actually want
    var TICKS = [
      { dest: 'about.html', label: 'About', frac: 0.32 },
      { dest: 'projects.html', label: 'Projects', frac: 0.62 },
      { dest: 'contact.html', label: 'Contact', frac: 0.95 }
    ];
    var MAX_PX = 300; // recomputed per grab, see pointerDown
    var dragging = false, moved = false, startX = 0, lastFrac = 0, userInteracted = false;
    var curScale = 1, curVel = 0, rafId = null;

    // stretches the name horizontally and spreads the letters out a bit as
    // it stretches -- s is the scaleX value, so 1 = normal size, 1.5 = 50%
    // wider. curScale is kept in a variable (not just read off the DOM)
    // because springTo() below needs to know the current value every frame.
    function applyScale(s) {
      curScale = s;
      var spacing = Math.max(0, s - 1) * 0.09;
      gripText.style.transform = 'scaleX(' + s.toFixed(4) + ')';
      gripText.style.letterSpacing = spacing.toFixed(4) + 'em';
    }
    // cancels whatever spring animation is currently mid-bounce, if any --
    // called whenever a new drag starts so two animations can't fight
    function stopSpring() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }
    // AI-suggested approach: a real damped-harmonic-oscillator simulation
    // (position + velocity integrated every animation frame) instead of a
    // canned CSS easing curve, so releasing the name overshoots and settles
    // like an actual spring. I tuned stiffness/damping per call site (e.g.
    // 150/6 for a big pull vs. 175/5.5 for a plain click) by trial and
    // error until the bounce felt right, rather than using whatever Claude
    // first suggested.
    //
    // What the step() function is actually doing, frame by frame: it's a
    // basic physics simulation of a spring pulling curScale toward target.
    //   force = how hard the spring is pulling right now. It's stronger
    //     the farther away curScale is from target (stiffness), and it
    //     resists the current speed (damping) so it doesn't oscillate
    //     forever -- this is literally Hooke's law (F = -kx) plus a drag
    //     term.
    //   curVel += force * dt -- force changes velocity (this is F = ma
    //     rearranged, with mass treated as 1).
    //   next = curScale + curVel * dt -- velocity changes position.
    // dt is capped at 0.032s so a slow/dropped frame can't make the spring
    // jump too far in one step. The loop keeps calling itself every frame
    // (requestAnimationFrame) until both the distance to target and the
    // remaining velocity are small enough to just snap to the exact target
    // and stop -- otherwise it would animate forever, chasing tiny decimals.
    function springTo(target, stiffness, damping) {
      stopSpring();
      if (reduceMotion) { applyScale(target); curVel = 0; return; }
      var last = performance.now();
      function step(now) {
        var dt = Math.min((now - last) / 1000, 0.032);
        last = now;
        var force = -stiffness * (curScale - target) - damping * curVel;
        curVel += force * dt;
        var next = curScale + curVel * dt;
        applyScale(next);
        if (Math.abs(next - target) > 0.002 || Math.abs(curVel) > 0.002) {
          rafId = requestAnimationFrame(step);
        } else {
          applyScale(target); curVel = 0; rafId = null;
        }
      }
      rafId = requestAnimationFrame(step);
    }
    // frac is "how far through the pull" from 0 to 1 (and a bit past 1 if
    // you overpull) -- this just turns that into a scaleX value
    function dragScale(frac) { return 1 + frac * 0.55; }

    // walks the TICKS list and returns the farthest one you've pulled past,
    // or null if you haven't reached About yet -- since TICKS is already in
    // ascending order, the last match in the loop is always the right one
    function tickFor(frac) {
      var hit = null;
      TICKS.forEach(function(tk){ if (frac >= tk.frac) hit = tk; });
      return hit;
    }
    // highlights whichever tick dot/label matches "dest" and dims the
    // others (or dims all of them if dest is null, e.g. before the first tick)
    function armTick(dest) {
      tickEls.forEach(function(el){ el.classList.toggle('armed', el.dataset.dest === dest); });
    }

    // these three functions run the whole drag gesture, in order:
    // pointerDown starts tracking a pull and figures out the max distance
    // for this screen size; pointerMove updates the stretch, the sound, and
    // which tick is armed every time the pointer moves; pointerUp decides
    // whether you actually committed to a page (armed a tick) or just
    // bounced back. Registered for both mouse (pointer*) and touch events
    // since not every browser treats touch as pointer events yet.
    function pointerDown(e) {
      userInteracted = true;
      dragging = true; moved = false; lastFrac = 0;
      // longer on wider screens (more room to space the ticks out), but
      // never further than a thumb or mouse can comfortably travel
      MAX_PX = Math.min(340, Math.max(210, window.innerWidth * 0.42));
      startX = (e.touches ? e.touches[0].clientX : e.clientX);
      stopSpring();
    }
    function pointerMove(e) {
      if (!dragging) return;
      // works for both mouse and touch: touch events store the coordinate
      // one level deeper, in a "touches" list, since a touchscreen can
      // technically track more than one finger at once
      var x = (e.touches ? e.touches[0].clientX : e.clientX);
      var dx = x - startX; // how far the pointer has moved sideways since pointerDown, in pixels
      if (Math.abs(dx) > 4) {
        // a tiny wobble under 4px still counts as "just a click," not a
        // real drag -- this is where that line actually gets crossed
        if (!moved) stretchStart(); // real drag just started -- begin the tension tone
        moved = true;
      }
      // clamp dx into the 0..MAX_PX range (can't pull backwards past 0, or
      // past the max), then convert it into lastFrac, a 0-to-1 fraction of
      // the full pull -- everything else (scale, sound, which tick is
      // armed) is driven off this one fraction instead of raw pixels
      var px = Math.max(0, Math.min(MAX_PX, dx));
      lastFrac = px / MAX_PX;
      applyScale(dragScale(lastFrac));
      if (moved) stretchUpdate(lastFrac); // pitch/brightness/volume track how far you've pulled
      var tk = tickFor(lastFrac); // which page (if any) is armed at the current pull distance
      armTick(tk ? tk.dest : null);
      if (statusEl) statusEl.textContent = tk ? ('→ ' + tk.label) : (moved ? 'keep pulling…' : IDLE_TEXT);
    }
    function pointerUp() {
      if (!dragging) return;
      dragging = false;
      stretchStop();
      if (!moved) playPluck(); // it was just a click, not a real drag -- play the pluck sound instead
      // only counts as "committing" to a page if it was a real drag AND it
      // ended past at least the first tick -- a plain click never navigates
      var tk = moved ? tickFor(lastFrac) : null;
      if (tk) {
        if (statusEl) statusEl.textContent = 'heading to ' + tk.label + '…';
        // reset before leaving: some browsers restore this exact page (with
        // its stretched name) from cache on the way back, instead of a
        // fresh load, so don't leave the stretch as the last-saved frame
        applyScale(1);
        var delay = reduceMotion ? 100 : 480;
        // small delay so the "heading to ___" message is actually visible
        // for a moment before the browser navigates away
        setTimeout(function(){ window.location.href = tk.dest; }, delay);
        return;
      }
      // didn't reach a tick (or it was just a click) -- spring back to
      // normal size instead of navigating anywhere
      armTick(null);
      if (statusEl) statusEl.textContent = IDLE_TEXT;
      if (moved) {
        springTo(1, 150, 6);
      } else {
        curVel += 1.4; // give it a little kick so a plain click still visibly "plucks" instead of just sitting still
        springTo(1, 175, 5.5);
      }
    }

    grip.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    grip.addEventListener('touchstart', pointerDown, { passive: true });
    window.addEventListener('touchmove', pointerMove, { passive: true });
    window.addEventListener('touchend', pointerUp);

    // AI-diagnosed bug fix: if the browser restores this page from cache
    // (back/forward, "bfcache") instead of a fresh load, it can still be
    // mid-stretch from the last visit -- ease it back to normal instead of
    // leaving it stuck. I wouldn't have known bfcache was the cause without
    // asking Claude to help debug it; I did understand and verify the fix
    // once it was explained (the `pageshow`/`persisted` check is the
    // standard way to detect a bfcache restore).
    window.addEventListener('pageshow', function(e){
      if (e.persisted && curScale !== 1) {
        dragging = false;
        armTick(null);
        if (statusEl) statusEl.textContent = IDLE_TEXT;
        springTo(1, 150, 6);
      }
    });

    // one-time onboarding nudge: a tiny automatic stretch, a glow on the
    // hint text, and a pulse on the graph panel, so first-time visitors
    // connect the two and learn the name is what drives it
    if (!reduceMotion) {
      setTimeout(function(){
        if (userInteracted || dragging) return;
        curVel += 0.55;
        springTo(1, 190, 7);
        if (statusEl) {
          statusEl.classList.add('hint');
          statusEl.addEventListener('animationend', function handler(){
            statusEl.classList.remove('hint');
            statusEl.removeEventListener('animationend', handler);
          });
        }
        if (heroGraph) {
          heroGraph.classList.add('hint');
          heroGraph.addEventListener('animationend', function handler(){
            heroGraph.classList.remove('hint');
            heroGraph.removeEventListener('animationend', handler);
          });
        }
      }, 900);
    }
  }

  /* ---------- PROJECTS: positioning chart ---------- */
  var detailCard = document.getElementById('detailCard');
  if (detailCard) {
    // all the project content lives right here instead of in the HTML --
    // each key (yonsei, flowx, etc.) matches the data-key attribute on that
    // project's point in projects.html, so renderDetail() below can look a
    // project up by key. "cat" picks the dot color (matches the legend),
    // "photos" is optional -- projects without one just get a placeholder
    // box instead of a carousel -- and so is "link".
    var projects = {
      yonsei: { title: 'Radiation Dosimetry Organ Modeling', cat: 'materials', tags: ['Research', 'Yonsei University'], featured: true,
        body: "Constructing 3D organ models from medical imaging data (TotalSegmentator) for Monte Carlo radiation-transport simulations in PHITS, modeling how dose deposits through human anatomy.",
        stats: [['PHITS', 'simulation engine'], ['CT/MRI', '3D organ models'], ['2025–26', 'ongoing']],
        photos: [
          { url: 'images/yonsei-1.png', caption: 'How computational human phantoms have evolved -- from 1960s stylized models to today’s mesh-type reference phantoms' },
          { url: 'images/yonsei-2.png', caption: 'A segmented liver model built for Monte Carlo dose simulation' }
        ],
        link: 'https://rsdl.yonsei.ac.kr/news/activities', linkLabel: 'See the lab in action ↗' },
      flowx: { title: 'Cardiovascular Fluid–Structure Modeling', cat: 'bme', tags: ['Research', 'Kyung Hee University'],
        body: "Designed 3D models of the lung and cardiovascular system from patients' CT/MRI scans with pediatric surgeons, studying fluid-structure interactions to help guide critical operations.",
        stats: [['CT/MRI', 'patient scans'], ['Pediatric', 'surgical planning'], ['Jul–Aug 2023', 'duration']],
        photos: [
          { url: 'images/flowx-1.png', caption: 'Simulated blood-flow through the aortic arch and its branches, color-mapped by flow' },
          { url: 'images/flowx-2.png', caption: 'The same model from a different angle, showing the full branching vasculature' }
        ] },
      nearthlab: { title: 'Antibacterial Drones & Phytoextract Research', cat: 'hybrid', tags: ['Applied', 'NearthLab', 'Independent Research'],
        body: "Two drone projects tackling antibiotic resistance from different angles. At NearthLab, I helped develop a prototype that sprays a natural antibacterial solution into public bodies of water, published in the company journal. Independently, I engineered an AI-powered drone to predict antibiotic-resistant bacteria, and tested plant extracts as inhibitors of plasmid-driven superbug transformation in pathogens thawed from permafrost.",
        stats: [['Prototype', 'drone, published'], ['AI-powered', 'outbreak prediction'], ['2024', 'duration']],
        photos: [
          { url: 'images/nearthlab-1.png', caption: 'The prototype on the water, and mid-flight' },
          { url: 'images/nearthlab-2.png', caption: 'Onboard electronics, and the first-person view during a test flight' }
        ],
        link: 'https://nearthlab.com/', linkLabel: 'NearthLab ↗' },
      primrose: { title: 'Evening Primrose Extract for Waterborne Infection', cat: 'bme', tags: ['Independent Research', '2023'],
        body: "Investigated Evening Primrose extract's anti-inflammatory and apoptosis-inducing effects as a natural treatment for waterborne infection and pulmonary disease in war-torn regions.",
        stats: [['Evening Primrose', 'extract'], ['Anti-inflammatory', '& apoptosis-inducing'], ['Jun–Sept 2023', 'duration']],
        photos: [
          { url: 'images/primrose-1.jpg', caption: 'Presenting this research at the Genius Olympiad' }
        ] }
    };
    var pts = Array.prototype.slice.call(document.querySelectorAll('.pt'));
    var legendBtns = Array.prototype.slice.call(document.querySelectorAll('#legend button'));
    var activeCats = { materials: true, hybrid: true, bme: true };
    var shotIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="5" width="19" height="14" rx="1.5"/><circle cx="9" cy="12" r="2.6"/><path d="M14 15l3-3.3 4 4.8"/></svg>';

    // Builds the whole right-hand detail card for one project (by key,
    // e.g. "yonsei") and drops it into the page as raw HTML. Two pieces
    // worth explaining:
    //
    // 1. "media" is built first, as its own variable, because it's an
    //    either/or: if this project has a "photos" array, build the
    //    swipeable carousel (one <figure> per photo, wrapped in a
    //    .photo-strip div -- the actual swipe gesture comes for free from
    //    CSS scroll-snap in style.css, not from any JS here); otherwise
    //    fall back to a plain placeholder box using shotIcon.
    // 2. detailCard.innerHTML is then one big string built with +, mixing
    //    the project's data (title, tags, description, stats) into the
    //    HTML template piece by piece. .map().join('') is how an array
    //    (like the tags list) turns into repeated HTML chunks -- map turns
    //    each tag into a <span>, join('') glues them together with nothing
    //    in between.
    function renderDetail(key) {
      var p = projects[key];
      var media = p.photos
        ? '<div class="photo-strip">' + p.photos.map(function(ph){
            return '<figure><img src="'+ph.url+'" alt="'+ph.caption+'" loading="lazy"><figcaption>'+ph.caption+'</figcaption></figure>';
          }).join('') + '</div>' +
          (p.photos.length > 1 ? '<p class="photo-hint">swipe for more →</p>' : '') +
          (p.photoCredit ? '<a class="photo-credit" href="'+p.photoCredit+'" target="_blank" rel="noopener">Photos: IDOL, Yonsei University ↗</a>' : '')
        : '<div class="shot-slot">'+shotIcon+'<span>image</span></div>';
      detailCard.innerHTML =
        '<div class="tagrow">' + (p.featured ? '<span class="pill featured">Featured</span>' : '') +
          p.tags.map(function(t){ return '<span class="pill">'+t+'</span>'; }).join('') + '</div>' +
        '<h3>'+p.title+'</h3>' +
        media +
        '<p>'+p.body+'</p>' +
        '<div class="stat-row">' + p.stats.map(function(s){ return '<div class="stat"><b>'+s[0]+'</b><span>'+s[1]+'</span></div>'; }).join('') + '</div>' +
        (p.link ? '<a class="code-link" href="'+p.link+'" target="_blank" rel="noopener">'+(p.linkLabel || 'Learn more ↗')+'</a>' : '');
    }
    // marks one point as the selected one (for the highlight ring) and
    // fills the detail card with its info
    function selectPoint(key) {
      pts.forEach(function(pt){ pt.classList.toggle('active', pt.dataset.key === key); });
      renderDetail(key);
    }
    // clicking a point selects it; Enter/Space does the same for anyone
    // tabbing through the chart with a keyboard instead of a mouse
    pts.forEach(function(pt){
      pt.addEventListener('click', function(){ selectPoint(pt.dataset.key); });
      pt.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPoint(pt.dataset.key); } });
    });
    selectPoint('yonsei'); // show something in the detail card before anyone's clicked

    // dims out points whose category has been toggled off in the legend,
    // rather than hiding them completely -- keeps the chart layout stable
    // instead of things jumping around as you filter
    function applyLegend() {
      pts.forEach(function(pt){
        // activeCats is a lookup of category -> true/false; a point whose
        // category is turned off gets faded out (opacity) and made
        // unclickable (pointerEvents: 'none') instead of removed, so the
        // chart layout never shifts around as you toggle filters
        pt.style.opacity = activeCats[pt.dataset.cat] ? '1' : '0.18';
        pt.style.pointerEvents = activeCats[pt.dataset.cat] ? 'auto' : 'none';
      });
      // 'off' just controls the legend button's own faded-out look, so it's
      // visually obvious which categories are currently hidden
      legendBtns.forEach(function(b){ b.classList.toggle('off', !activeCats[b.dataset.cat]); });
    }
    // each legend button flips its own category's true/false and re-runs
    // applyLegend() to redraw everything based on the new state
    legendBtns.forEach(function(b){
      b.addEventListener('click', function(){
        activeCats[b.dataset.cat] = !activeCats[b.dataset.cat];
        applyLegend();
      });
    });
  }

  /* ---------- CONTACT: form actually sends, via FormSubmit.co ----------
     A static GitHub Pages site has no server of its own to send email
     from, so the form posts to FormSubmit (a free, no-account form-relay
     service) instead of falling back to a mailto: link.

     I tried doing this with fetch() first so the visitor never leaves the
     page, but that turned out unreliable -- the AJAX request would just
     hang with no error, likely blocked somewhere between the browser and
     FormSubmit (an ad blocker, or a network filter) with no way for my
     code to detect that. A plain form submission doesn't have that
     problem: the browser handles it directly instead of my JS waiting on
     a promise, so there's nothing for JS to get stuck on. The tradeoff is
     a real page reload -- FormSubmit sends the visitor back here via the
     hidden "_next" field, and the "?sent=true" on that URL is how this
     page knows to show a thank-you message instead of the empty form. */
  var contactForm = document.querySelector('.contact-form');
  if (contactForm) {
    var formStatus = document.getElementById('formStatus');
    var submitBtn = contactForm.querySelector('button[type="submit"]');

    // location.search is the "?..." part of the current URL. The regex
    // checks for "sent=true" showing up right after a ? or & (so it
    // matches "?sent=true" and "?x=1&sent=true" but not something like
    // "?notsent=true"). If it's there, this page load is the redirect
    // FormSubmit sent the visitor back to after a successful submission,
    // so swap the form out for a thank-you message instead of showing an
    // empty form again.
    if (/[?&]sent=true\b/.test(location.search)) {
      contactForm.hidden = true;
      formStatus.textContent = "Thanks — your message sent. I'll get back to you soon.";
      // tidy the URL so refreshing the page doesn't show the same message again
      history.replaceState(null, '', location.pathname);
    }

    // this just gives quick visual feedback before the page navigates away
    // to FormSubmit -- it doesn't (and can't) get stuck, since the actual
    // submit isn't happening in JS at all
    contactForm.addEventListener('submit', function(){
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
    });
  }

})();
