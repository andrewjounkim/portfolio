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
      yonsei: { title: 'Radiation Dosimetry Organ Modeling', cat: 'materials', tags: ['Research', 'Yonsei University'], featured: true,
        body: "Constructing 3D organ models from medical imaging data (TotalSegmentator) for Monte Carlo radiation-transport simulations in PHITS, modeling how dose deposits through human anatomy.",
        stats: [['PHITS', 'simulation engine'], ['CT/MRI', '3D organ models'], ['2025–26', 'ongoing']] },
      flowx: { title: 'Cardiovascular Fluid–Structure Modeling', cat: 'bme', tags: ['Research', 'Kyung Hee University'],
        body: "Designed 3D models of the lung and cardiovascular system from patients' CT/MRI scans with pediatric surgeons, studying fluid-structure interactions to help guide critical operations.",
        stats: [['CT/MRI', 'patient scans'], ['Pediatric', 'surgical planning'], ['Jul–Aug 2023', 'duration']] },
      nearthlab: { title: 'Antibiotic-Resistance Prevention Drone', cat: 'hybrid', tags: ['Applied', 'NearthLab'],
        body: "Developed a prototype drone that sprays a natural solution into public bodies of water to prevent infection linked to antibiotic resistance, and published the work in the company journal.",
        stats: [['Prototype', 'drone built'], ['Published', 'company journal'], ['Jun–Nov 2024', 'duration']] },
      superbug: { title: 'Phytoextract Superbug Inhibitor + Predictive Drone', cat: 'hybrid', tags: ['Independent Research', '2024'],
        body: "Engineered an AI-powered drone to predict antibiotic-resistant bacteria, and tested plant extracts as inhibitors of plasmid-driven superbug transformation in pathogens thawed from permafrost.",
        stats: [['AI-powered', 'drone system'], ['Plant extracts', 'as inhibitors'], ['Jun–Sept 2024', 'duration']] },
      primrose: { title: 'Evening Primrose Extract for Waterborne Infection', cat: 'bme', tags: ['Independent Research', '2023'],
        body: "Investigated Evening Primrose extract's anti-inflammatory and apoptosis-inducing effects as a natural treatment for waterborne infection and pulmonary disease in war-torn regions.",
        stats: [['Evening Primrose', 'extract'], ['Anti-inflammatory', '& apoptosis-inducing'], ['Jun–Sept 2023', 'duration']] }
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
        '<div class="shot-slot">'+shotIcon+'<span>image</span></div>' +
        '<p>'+p.body+'</p>' +
        '<div class="stat-row">' + p.stats.map(function(s){ return '<div class="stat"><b>'+s[0]+'</b><span>'+s[1]+'</span></div>'; }).join('') + '</div>' +
        (p.link ? '<a class="code-link" href="'+p.link+'" target="_blank" rel="noopener">'+(p.linkLabel || 'Learn more ↗')+'</a>' : '');
    }
    function selectPoint(key) {
      pts.forEach(function(pt){ pt.classList.toggle('active', pt.dataset.key === key); });
      renderDetail(key);
    }
    pts.forEach(function(pt){
      pt.addEventListener('click', function(){ selectPoint(pt.dataset.key); });
      pt.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPoint(pt.dataset.key); } });
    });
    selectPoint('yonsei');

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
