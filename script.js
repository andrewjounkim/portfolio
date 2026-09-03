(function(){
  "use strict";
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- HOME: pull the name to navigate ---------- */
  var grip = document.getElementById('grip');
  if (grip) {
    var gripText = document.getElementById('gripText');
    var heroGraph = document.getElementById('heroGraph');
    var statusEl = document.getElementById('pullStatus');
    var tickEls = Array.prototype.slice.call(document.querySelectorAll('.tick'));
    var IDLE_TEXT = statusEl ? statusEl.textContent : 'stretch to explore';
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

    function applyScale(s) {
      curScale = s;
      var spacing = Math.max(0, s - 1) * 0.09;
      gripText.style.transform = 'scaleX(' + s.toFixed(4) + ')';
      gripText.style.letterSpacing = spacing.toFixed(4) + 'em';
    }
    function stopSpring() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }
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
    function dragScale(frac) { return 1 + frac * 0.55; }

    function tickFor(frac) {
      var hit = null;
      TICKS.forEach(function(tk){ if (frac >= tk.frac) hit = tk; });
      return hit;
    }
    function armTick(dest) {
      tickEls.forEach(function(el){ el.classList.toggle('armed', el.dataset.dest === dest); });
    }

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
      var x = (e.touches ? e.touches[0].clientX : e.clientX);
      var dx = x - startX;
      if (Math.abs(dx) > 4) moved = true;
      var px = Math.max(0, Math.min(MAX_PX, dx));
      lastFrac = px / MAX_PX;
      applyScale(dragScale(lastFrac));
      var tk = tickFor(lastFrac);
      armTick(tk ? tk.dest : null);
      if (statusEl) statusEl.textContent = tk ? ('→ ' + tk.label) : (moved ? 'keep pulling…' : IDLE_TEXT);
    }
    function pointerUp() {
      if (!dragging) return;
      dragging = false;
      var tk = moved ? tickFor(lastFrac) : null;
      if (tk) {
        if (statusEl) statusEl.textContent = 'heading to ' + tk.label + '…';
        // reset before leaving: some browsers restore this exact page (with
        // its stretched name) from cache on the way back, instead of a
        // fresh load, so don't leave the stretch as the last-saved frame
        applyScale(1);
        var delay = reduceMotion ? 100 : 480;
        setTimeout(function(){ window.location.href = tk.dest; }, delay);
        return;
      }
      armTick(null);
      if (statusEl) statusEl.textContent = IDLE_TEXT;
      if (moved) {
        springTo(1, 150, 6);
      } else {
        curVel += 1.4;
        springTo(1, 175, 5.5);
      }
    }

    grip.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    grip.addEventListener('touchstart', pointerDown, { passive: true });
    window.addEventListener('touchmove', pointerMove, { passive: true });
    window.addEventListener('touchend', pointerUp);

    // if the browser restores this page from cache (back/forward) instead of
    // a fresh load, it can still be mid-stretch from the last visit -- ease
    // it back to normal instead of leaving it stuck
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
    var projects = {
      scaffold: { title: 'Piezoelectric Bone Scaffolds', cat: 'materials', tags: ['Materials', 'Research'], featured: true, code: '#',
        body: "3D-printed PVDF–barium-titanate lattice that turns ordinary joint loading into a local electric field, mimicking bone's own growth signal.",
        stats: [['0.35mm', 'strut res.'], ['23%', '↑ proliferation'], ['14mo', 'duration']] },
      stent: { title: 'Nitinol Stent Fatigue Modeling', cat: 'materials', tags: ['Materials', 'Research'], code: '#',
        body: "Cyclic-loading fatigue model for shape-memory-alloy stents, predicting crack initiation before it happens inside a patient.",
        stats: [['10M', 'cycles modeled'], ['3', 'failure modes ID’d'], ['6mo', 'duration']] },
      sweat: { title: 'Sweat Biosensor Substrate', cat: 'hybrid', tags: ['Biomedical', 'Applied'], code: '#',
        body: "Flexible, biocompatible polymer substrate carrying an electrochemical sensor array for continuous wearable sweat analysis.",
        stats: [['<2mm', 'substrate thickness'], ['92%', 'signal retention, 8h wear'], ['4mo', 'duration']] },
      hydrogel: { title: 'Hydrogel Prosthetic Actuator', cat: 'bme', tags: ['Biomedical', 'Applied'], code: '#',
        body: "pH-responsive hydrogel actuator that contracts like muscle tissue, aimed at low-cost prosthetic grip assistance.",
        stats: [['38%', 'contraction strain'], ['<$40', 'materials cost'], ['5mo', 'duration']] }
    };
    var pts = Array.prototype.slice.call(document.querySelectorAll('.pt'));
    var legendBtns = Array.prototype.slice.call(document.querySelectorAll('#legend button'));
    var activeCats = { materials: true, hybrid: true, bme: true };
    var shotIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="5" width="19" height="14" rx="1.5"/><circle cx="9" cy="12" r="2.6"/><path d="M14 15l3-3.3 4 4.8"/></svg>';

    function renderDetail(key) {
      var p = projects[key];
      detailCard.innerHTML =
        '<div class="tagrow">' + (p.featured ? '<span class="pill featured">Featured</span>' : '') +
          p.tags.map(function(t){ return '<span class="pill">'+t+'</span>'; }).join('') + '</div>' +
        '<h3>'+p.title+'</h3>' +
        '<div class="shot-slot">'+shotIcon+'<span>screenshot</span></div>' +
        '<p>'+p.body+'</p>' +
        '<div class="stat-row">' + p.stats.map(function(s){ return '<div class="stat"><b>'+s[0]+'</b><span>'+s[1]+'</span></div>'; }).join('') + '</div>' +
        '<a class="code-link" href="'+p.code+'" target="_blank" rel="noopener">View code ↗</a>';
    }
    function selectPoint(key) {
      pts.forEach(function(pt){ pt.classList.toggle('active', pt.dataset.key === key); });
      renderDetail(key);
    }
    pts.forEach(function(pt){
      pt.addEventListener('click', function(){ selectPoint(pt.dataset.key); });
      pt.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPoint(pt.dataset.key); } });
    });
    selectPoint('scaffold');

    function applyLegend() {
      pts.forEach(function(pt){
        pt.style.opacity = activeCats[pt.dataset.cat] ? '1' : '0.18';
        pt.style.pointerEvents = activeCats[pt.dataset.cat] ? 'auto' : 'none';
      });
      legendBtns.forEach(function(b){ b.classList.toggle('off', !activeCats[b.dataset.cat]); });
    }
    legendBtns.forEach(function(b){
      b.addEventListener('click', function(){
        activeCats[b.dataset.cat] = !activeCats[b.dataset.cat];
        applyLegend();
      });
    });
  }

  /* ---------- CONTACT: spec sheet modal ---------- */
  var backdrop = document.getElementById('specBackdrop');
  if (backdrop) {
    var openBtn = document.getElementById('openSpec');
    var closeBtn = document.getElementById('closeSpec');
    function openModal(){ backdrop.classList.add('open'); closeBtn.focus(); }
    function closeModal(){ backdrop.classList.remove('open'); openBtn.focus(); }
    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', function(e){ if (e.target === backdrop) closeModal(); });
    window.addEventListener('keydown', function(e){ if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal(); });
  }
})();
