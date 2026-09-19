/*
 * AI USAGE NOTE (Claude, Anthropic): I used Claude as a coding partner for
 * this page. I chose the topic (betting lines) and the "line movement"
 * angle; Claude explored ESPN's scoreboard endpoint with me (looking at the
 * raw JSON first, including the odd cases like "OFF" odds and soccer's
 * three-way moneyline), then helped write the odds math and the interface.
 * The prompts that shaped it are in API_PROMPT_LOG.md in the repo root.
 *
 * HOW THE API IS CALLED: one GET per league to
 *   https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard
 * with an optional ?dates=YYYYMMDD. No key. It returns JSON with an "events"
 * array; each event has a competitions[0].odds[0] object holding DraftKings'
 * moneyline / pointSpread / total, each with an "open" and a "close" value.
 */
(function(){
  "use strict";
  var root = document.getElementById('games');
  if (!root) return; // only runs on linemoves.html

  var BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
  // id is what goes in the page URL (?league=nfl); path is ESPN's sport/league
  var LEAGUES = [
    { id: 'nfl', label: 'NFL',            path: 'football/nfl' },
    { id: 'cfb', label: 'College Football', path: 'football/college-football' },
    { id: 'nba', label: 'NBA',            path: 'basketball/nba' },
    { id: 'mlb', label: 'MLB',            path: 'baseball/mlb' },
    { id: 'nhl', label: 'NHL',            path: 'hockey/nhl' },
    { id: 'mls', label: 'MLS',            path: 'soccer/usa.1' },
    { id: 'epl', label: 'Premier League', path: 'soccer/eng.1' }
  ];
  var TIMEOUT_MS = 15000;  // give up on a request after this long
  var CACHE_MS = 30000;    // reuse a response this long so flipping between tabs doesn't spam ESPN
  var cache = {};          // url -> { t: time fetched, data: parsed JSON }

  /* ---------- ODDS MATH (pure functions, no page access) ---------- */

  // "-150" -> -150, "+130" -> 130, "EVEN" -> 100. Returns null for anything
  // that isn't real American odds -- in particular the literal string "OFF"
  // that ESPN sends when a market is suspended, and anything between -100 and
  // +100 (American odds can't be in that gap, so it would be bad data).
  function parseAmerican(s){
    if (s == null) return null;
    var t = String(s).trim().toUpperCase();
    if (t === 'EVEN' || t === 'EV') return 100;
    if (!/^[+-]?\d+$/.test(t)) return null;
    var n = parseInt(t, 10);
    return Math.abs(n) < 100 ? null : n;
  }

  // American odds -> the win probability the price implies.
  //   +130 means $100 wins $130, so break-even is 100 / (130 + 100) = 43.5%
  //   -150 means you risk $150 to win $100, so break-even is 150 / (150 + 100) = 60%
  function impliedProb(american){
    return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
  }

  // Takes { home: -150, away: 130, draw: 280 } (draw is optional) and returns
  //   implied: each side's implied probability (these add up to MORE than 1)
  //   fair:    those, rescaled to add to exactly 1 (the "no-vig" probabilities)
  //   vig:     how far over 1 they were -- the sportsbook's built-in margin
  // Returns null if any price is missing, since a partial market can't be normalized.
  function fairProbs(prices){
    var sides = Object.keys(prices), implied = {}, total = 0, i;
    for (i = 0; i < sides.length; i++) {
      if (prices[sides[i]] == null) return null;
      implied[sides[i]] = impliedProb(prices[sides[i]]);
      total += implied[sides[i]];
    }
    var fair = {};
    sides.forEach(function(s){ fair[s] = implied[s] / total; });
    return { implied: implied, fair: fair, vig: total - 1 };
  }

  // "+2.5" -> 2.5, "-1.5" -> -1.5, "o43.5" / "u43.5" -> 43.5, "PK" -> 0.
  // null for "OFF", missing, or anything else that isn't a number.
  function parseLine(s){
    if (s == null) return null;
    var t = String(s).trim().toLowerCase().replace(/^[ou]/, '');
    if (t === 'pk' || t === 'pick') return 0;
    return /^[+-]?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
  }

  // safely walk into nested JSON: dig(ev, ['competitions', 0, 'odds']) --
  // returns undefined instead of throwing if any step is missing, which
  // matters because ESPN doesn't include every field for every game
  function dig(obj, keys){
    for (var i = 0; i < keys.length; i++) {
      if (obj == null) return undefined;
      obj = obj[keys[i]];
    }
    return obj;
  }

  // Turns one raw ESPN event into just the numbers this page needs.
  // Never throws on odd data: a game whose lines can't be read just comes
  // back with usable:false and gets counted as "no usable lines".
  function buildGame(ev){
    var comp = dig(ev, ['competitions', 0]);
    if (!comp) return null;
    var teams = {};
    (comp.competitors || []).forEach(function(c){
      teams[c.homeAway] = {
        abbr: dig(c, ['team', 'abbreviation']) || dig(c, ['team', 'shortDisplayName']) || '?',
        name: dig(c, ['team', 'displayName']) || '?'
      };
    });
    if (!teams.home || !teams.away) return null;

    var odds = dig(comp, ['odds', 0]);
    var g = {
      id: ev.id, date: ev.date, state: dig(ev, ['status', 'type', 'state']),
      home: teams.home, away: teams.away,
      book: dig(odds, ['provider', 'name']) || 'sportsbook',
      usable: false, hasDraw: false,
      ml: null, mlMove: null, spread: null, spreadMove: null, total: null, totalMove: null
    };
    if (!odds) return g;

    // MONEYLINE: fair probabilities at open and now. A game is only
    // "usable" (rankable) if both are readable.
    var ml = odds.moneyline;
    if (ml) {
      g.hasDraw = !!ml.draw;
      var sides = g.hasDraw ? ['home', 'away', 'draw'] : ['home', 'away'];
      var at = function(which){
        var prices = {};
        sides.forEach(function(s){ prices[s] = parseAmerican(dig(ml, [s, which, 'odds'])); });
        return { prices: prices, probs: fairProbs(prices) };
      };
      var open = at('open'), now = at('close'); // ESPN calls the current line "close"
      if (open.probs && now.probs) {
        g.usable = true;
        g.ml = { sides: sides, open: open, now: now };
        // positive = the market moved toward the home team
        g.mlMove = now.probs.fair.home - open.probs.fair.home;
      }
    }

    // SPREAD: measured in points, from the home team's point of view.
    // Home line going from -1.5 to +2.5 means home went from favorite to
    // underdog: the market moved toward the away team.
    var sp = dig(odds, ['pointSpread', 'home']);
    var spOpen = parseLine(dig(sp, ['open', 'line'])), spNow = parseLine(dig(sp, ['close', 'line']));
    if (spOpen != null && spNow != null) {
      g.spread = { open: spOpen, now: spNow,
        openOdds: parseAmerican(dig(sp, ['open', 'odds'])), nowOdds: parseAmerican(dig(sp, ['close', 'odds'])) };
      g.spreadMove = spNow - spOpen;
    }

    // TOTAL (over/under): combined points expected, in points
    var ov = dig(odds, ['total', 'over']);
    var toOpen = parseLine(dig(ov, ['open', 'line'])), toNow = parseLine(dig(ov, ['close', 'line']));
    if (toOpen != null && toNow != null) {
      g.total = { open: toOpen, now: toNow,
        openOdds: parseAmerican(dig(ov, ['open', 'odds'])), nowOdds: parseAmerican(dig(ov, ['close', 'odds'])) };
      g.totalMove = toNow - toOpen;
    }
    return g;
  }

  /* ---------- NETWORK ---------- */

  // GET a URL as JSON. On failure it rejects with { kind: ... } so the UI
  // can say something specific instead of a generic "error".
  function fetchJSON(url, force){
    var hit = cache[url];
    if (!force && hit && Date.now() - hit.t < CACHE_MS) return Promise.resolve(hit.data);
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, { signal: ctrl.signal }).then(function(res){
      if (!res.ok) throw { kind: 'http', status: res.status };
      return res.json().catch(function(){ throw { kind: 'parse' }; });
    }).then(function(data){
      clearTimeout(timer);
      cache[url] = { t: Date.now(), data: data };
      return data;
    }, function(err){
      clearTimeout(timer);
      if (err && err.kind) throw err;                          // one of ours, pass it on
      if (err && err.name === 'AbortError') throw { kind: 'timeout' };
      throw { kind: 'network' };                               // fetch itself failed: offline, DNS, blocked
    });
  }

  function describeError(err){
    // a browser reports "offline", "DNS failed", and "the server refused a cross-site request"
    // all as the same opaque TypeError, so this message has to cover more than one cause
    if (err && err.kind === 'network') return "Couldn't load data from ESPN. This is usually a lost connection (check it, then hit Refresh), but ESPN can also block requests from browsers.";
    if (err && err.kind === 'timeout') return 'ESPN took too long to answer (over ' + (TIMEOUT_MS / 1000) + ' seconds). Try Refresh in a moment.';
    if (err && err.kind === 'http') {
      if (err.status === 429) return "ESPN is rate-limiting requests from this browser. Wait a minute, then hit Refresh.";
      if (err.status >= 500) return "ESPN's servers are having trouble (HTTP " + err.status + "). Try again shortly.";
      return "ESPN didn't accept that request (HTTP " + err.status + "). Try a different day or league.";
    }
    if (err && (err.kind === 'parse' || err.kind === 'shape')) return "ESPN answered, but not with data this page understands. Their endpoint may have changed.";
    return 'Something unexpected went wrong while reading the data.';
  }

  /* ---------- PAGE STATE ---------- */
  var state = { league: 'nfl', day: '', sort: 'ml', runId: 0, games: [], counts: null, updated: null, openId: null };

  var els = {
    tabs: document.getElementById('leagueTabs'),
    day: document.getElementById('dayInput'),
    sort: document.getElementById('sortSelect'),
    refresh: document.getElementById('refreshBtn'),
    status: document.getElementById('status'),
    summary: document.getElementById('summary'),
    games: root
  };

  function leagueById(id){
    for (var i = 0; i < LEAGUES.length; i++) if (LEAGUES[i].id === id) return LEAGUES[i];
    return LEAGUES[0];
  }
  function el(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent, never innerHTML: API text is untrusted
    return n;
  }
  function setStatus(msg, kind){
    els.status.textContent = msg || '';
    els.status.className = 'ex-status' + (kind ? ' ' + kind : '');
  }

  /* ---------- FORMATTING ---------- */
  function pts(frac){ return (Math.abs(frac) * 100).toFixed(1); }        // 0.0163 -> "1.6"
  function pct(frac){ return (frac * 100).toFixed(1) + '%'; }
  function am(n){ return n == null ? '—' : (n > 0 ? '+' + n : String(n)); }
  function line(n){ return n == null ? '—' : (n === 0 ? 'PK' : (n > 0 ? '+' + n : String(n))); }
  function when(iso){
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  // words for a move on the win-probability scale, e.g. "toward ATL by 1.6 pts"
  function moveWords(g){
    if (Math.abs(g.mlMove) < 0.0005) return 'no move';
    return 'toward ' + (g.mlMove > 0 ? g.home.abbr : g.away.abbr) + ' by ' + pts(g.mlMove) + ' pts';
  }

  /* ---------- LOAD ---------- */
  function load(force){
    var id = ++state.runId;               // if the user clicks again before this finishes, the older response is ignored
    var league = leagueById(state.league);
    var url = BASE + league.path + '/scoreboard' + (state.day ? '?dates=' + state.day.replace(/-/g, '') : '');
    els.refresh.disabled = true;
    setStatus('Loading ' + league.label + ' lines…', 'loading');
    fetchJSON(url, force).then(function(data){
      if (id !== state.runId) return;
      if (!data || !Array.isArray(data.events)) throw { kind: 'shape' };
      ingest(data.events);
      state.updated = new Date();
      render();
    }).catch(function(err){
      if (id !== state.runId) return;
      if (!(err && err.kind)) console.error(err);   // a bug on our side, not a network problem
      state.games = []; state.counts = null;
      els.summary.hidden = true;
      els.games.textContent = '';
      setStatus(describeError(err), 'error');
    }).then(function(){
      if (id === state.runId) els.refresh.disabled = false;
    });
  }

  // Sorts every event into: tracked (not started, lines readable), or
  // counted-but-skipped (already started / finished / no readable lines)
  function ingest(events){
    var c = { total: events.length, started: 0, nolines: 0 };
    state.games = [];
    events.forEach(function(ev){
      var g = buildGame(ev);
      if (!g) return;
      if (g.state !== 'pre') { c.started++; return; }
      if (!g.usable) { c.nolines++; return; }
      state.games.push(g);
    });
    state.counts = c;
  }

  /* ---------- RENDER ---------- */
  function metric(g){
    var v = state.sort === 'ml' ? g.mlMove : state.sort === 'spread' ? g.spreadMove : state.sort === 'total' ? g.totalMove : null;
    return v == null ? null : Math.abs(v);
  }
  function sorted(){
    var list = state.games.slice();
    if (state.sort === 'time') return list.sort(function(a, b){ return new Date(a.date) - new Date(b.date); });
    // biggest first; games with no value for this measure sink to the bottom
    return list.sort(function(a, b){
      var x = metric(a), y = metric(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    });
  }

  function render(){
    var c = state.counts, league = leagueById(state.league);
    els.games.textContent = '';
    els.summary.hidden = true;
    if (!state.games.length) {
      var why = c.total === 0
        ? 'No ' + league.label + ' games are scheduled ' + (state.day ? 'on that day.' : 'right now.')
        : 'None of the ' + c.total + ' ' + league.label + ' games here have pre-game lines to track' +
          (c.started ? ' (' + c.started + ' already started or finished)' : '') +
          (c.nolines ? (c.started ? ', ' : ' (') + c.nolines + ' with no readable odds' + (c.started ? '' : ')') : '') + '.';
      setStatus(why + ' Try another league or pick a different day.', 'empty');
      return;
    }
    var skipped = c.started + c.nolines;
    setStatus('Tracking ' + state.games.length + ' upcoming ' + league.label + ' game' + (state.games.length === 1 ? '' : 's') +
      (skipped ? ' · ' + skipped + ' skipped (started, finished, or no readable odds)' : '') +
      ' · updated ' + state.updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

    // bars share one scale per slate so they're comparable, never less than 2 pts
    var maxMove = 0;
    state.games.forEach(function(g){ maxMove = Math.max(maxMove, Math.abs(g.mlMove) * 100); });
    var scale = Math.max(2, Math.ceil(maxMove));

    renderSummary();
    var list = sorted();
    list.forEach(function(g){ els.games.appendChild(renderGame(g, scale)); });
  }

  function renderSummary(){
    var gs = state.games, sum = 0, top = gs[0];
    gs.forEach(function(g){
      sum += Math.abs(g.mlMove);
      if (Math.abs(g.mlMove) > Math.abs(top.mlMove)) top = g;
    });
    els.summary.textContent = '';
    [
      [String(gs.length), 'games tracked'],
      [pts(sum / gs.length) + ' pts', 'average move'],
      [top.away.abbr + ' @ ' + top.home.abbr, 'biggest mover · ' + moveWords(top)]
    ].forEach(function(s){
      var box = el('div', 'stat');
      box.appendChild(el('b', null, s[0]));
      box.appendChild(el('span', null, s[1]));
      els.summary.appendChild(box);
    });
    els.summary.hidden = false;
  }

  function chip(label, from, to, moved){
    var c = el('span', 'lm-chip' + (moved ? ' moved' : ''));
    c.appendChild(el('i', null, label));
    c.appendChild(document.createTextNode(moved ? from + ' → ' + to : to + ' · flat'));
    return c;
  }

  function renderGame(g, scale){
    var isOpen = state.openId === g.id;
    var card = el('article', 'lm-game' + (isOpen ? ' open' : ''));
    var head = el('button', 'lm-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(isOpen));

    var match = el('div', 'lm-match');
    match.appendChild(el('span', 'lm-teams', g.away.abbr + ' @ ' + g.home.abbr));
    match.appendChild(el('span', 'lm-when', when(g.date)));
    head.appendChild(match);

    // diverging bar: the middle is "no move"; left = market moved toward
    // the away team, right = toward the home team
    var bar = el('div', 'lm-bar');
    bar.appendChild(el('span', 'lm-mid'));
    var half = Math.min(Math.abs(g.mlMove) * 100 / scale, 1) * 50;
    var fill = el('span', 'lm-fill ' + (g.mlMove > 0 ? 'home' : 'away'));
    fill.style.width = half + '%';
    fill.style[g.mlMove > 0 ? 'left' : 'right'] = '50%';
    bar.appendChild(fill);
    var barWrap = el('div', 'lm-barwrap');
    barWrap.appendChild(bar);
    barWrap.appendChild(el('span', 'lm-barlabel', moveWords(g)));
    head.appendChild(barWrap);

    var chips = el('div', 'lm-chips');
    if (g.spread) chips.appendChild(chip('spread', g.home.abbr + ' ' + line(g.spread.open), g.home.abbr + ' ' + line(g.spread.now), g.spreadMove !== 0));
    if (g.total) chips.appendChild(chip('total', String(g.total.open), String(g.total.now), g.totalMove !== 0));
    head.appendChild(chips);

    var detail = el('div', 'lm-detail');
    detail.hidden = !isOpen;
    if (isOpen) fillDetail(detail, g);
    head.addEventListener('click', function(){
      var nowOpen = detail.hidden;          // hidden now means we're about to open it
      state.openId = nowOpen ? g.id : null;
      detail.hidden = !nowOpen;
      card.classList.toggle('open', nowOpen);
      head.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen && !detail.firstChild) fillDetail(detail, g);   // built lazily, on first open
    });
    card.appendChild(head);
    card.appendChild(detail);
    return card;
  }

  // the expanded panel: a sentence in plain English, a dumbbell of the home
  // team's fair win probability (open -> now), and the full table of numbers
  function fillDetail(box, g){
    var o = g.ml.open.probs, n = g.ml.now.probs;
    var sentence = 'At the open the market gave ' + g.home.name + ' a ' + pct(o.fair.home) + ' fair chance of winning; now it says ' +
      pct(n.fair.home) + '. That is a move of ' + pts(g.mlMove) + ' points ' +
      (Math.abs(g.mlMove) < 0.0005 ? '(none).' : 'toward ' + (g.mlMove > 0 ? g.home.name : g.away.name) + '.');
    box.appendChild(el('p', 'lm-sentence', sentence));
    box.appendChild(dumbbell(g, o.fair.home, n.fair.home));

    var table = el('table', 'lm-table');
    var thead = el('thead'), hr = el('tr');
    ['', 'Open', 'Now', 'Open fair', 'Now fair', 'Change'].forEach(function(h){ hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el('tbody');
    g.ml.sides.forEach(function(s){
      var tr = el('tr');
      var label = s === 'home' ? g.home.abbr : s === 'away' ? g.away.abbr : 'Draw';
      var d = n.fair[s] - o.fair[s];
      [label, am(g.ml.open.prices[s]), am(g.ml.now.prices[s]), pct(o.fair[s]), pct(n.fair[s]),
       (d > 0 ? '+' : d < 0 ? '−' : '') + pts(d) + ' pts'].forEach(function(t, i){
        tr.appendChild(el(i === 0 ? 'th' : 'td', null, t));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    box.appendChild(table);

    var facts = el('ul', 'lm-facts');
    facts.appendChild(el('li', null, 'Sportsbook margin (vig) built into the moneyline: ' + pct(o.vig) + ' at open, ' + pct(n.vig) + ' now. ' +
      'The raw prices add up to more than 100%; the fair columns divide that extra out.'));
    if (g.spread) facts.appendChild(el('li', null, g.home.abbr + ' spread: ' + line(g.spread.open) + ' (' + am(g.spread.openOdds) + ') → ' +
      line(g.spread.now) + ' (' + am(g.spread.nowOdds) + ')' + (g.spreadMove ? ', ' + Math.abs(g.spreadMove) + ' points ' + (g.spreadMove > 0 ? 'toward ' + g.away.abbr : 'toward ' + g.home.abbr) : ', unchanged') + '.'));
    if (g.total) facts.appendChild(el('li', null, 'Over/under: ' + g.total.open + ' (' + am(g.total.openOdds) + ') → ' +
      g.total.now + ' (' + am(g.total.nowOdds) + ')' + (g.totalMove ? ', ' + (g.totalMove > 0 ? 'up ' : 'down ') + Math.abs(g.totalMove) + ' points' : ', unchanged') + '.'));
    facts.appendChild(el('li', null, 'Source: ' + g.book + ', via ESPN.'));
    box.appendChild(facts);
  }

  // small SVG: 0-100% axis, a tick at 50%, hollow dot = open, filled dot = now
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs){
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function(k){ n.setAttribute(k, attrs[k]); });
    return n;
  }
  function dumbbell(g, from, to){
    var W = 300, x = function(p){ return 12 + p * (W - 24); };
    var s = svgEl('svg', { viewBox: '0 0 ' + W + ' 54', class: 'lm-dumbbell', role: 'img',
      'aria-label': g.home.abbr + ' fair win probability moved from ' + pct(from) + ' to ' + pct(to) });
    s.appendChild(svgEl('line', { class: 'axis', x1: x(0), y1: 22, x2: x(1), y2: 22 }));
    s.appendChild(svgEl('line', { class: 'mid', x1: x(0.5), y1: 14, x2: x(0.5), y2: 30 }));
    s.appendChild(svgEl('line', { class: 'move', x1: x(from), y1: 22, x2: x(to), y2: 22 }));
    s.appendChild(svgEl('circle', { class: 'from', cx: x(from), cy: 22, r: 6 }));
    s.appendChild(svgEl('circle', { class: 'to', cx: x(to), cy: 22, r: 6 }));
    [[0, '0%', 'start'], [0.5, '50%', 'middle'], [1, '100%', 'end']].forEach(function(t){
      var label = svgEl('text', { x: x(t[0]), y: 46, 'text-anchor': t[2] });
      label.textContent = t[1];
      s.appendChild(label);
    });
    var cap = svgEl('text', { class: 'cap', x: x(0.5), y: 8, 'text-anchor': 'middle' });
    cap.textContent = g.home.abbr + ' fair win probability: hollow = open, filled = now';
    s.appendChild(cap);
    return s;
  }

  /* ---------- CONTROLS + URL ---------- */
  function syncUrl(){
    try {
      var p = new URLSearchParams();
      if (state.league !== 'nfl') p.set('league', state.league);
      if (state.day) p.set('day', state.day);
      if (state.sort !== 'ml') p.set('sort', state.sort);
      var q = p.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
    } catch (e) { /* replaceState can throw on file:// -- the page works fine without it */ }
  }
  function paintTabs(){
    Array.prototype.forEach.call(els.tabs.children, function(b){
      b.setAttribute('aria-pressed', String(b.dataset.id === state.league));
    });
  }

  LEAGUES.forEach(function(l){
    var b = el('button', 'lm-tab', l.label);
    b.type = 'button'; b.dataset.id = l.id;
    b.addEventListener('click', function(){
      if (state.league === l.id) return;
      state.league = l.id; state.openId = null;
      paintTabs(); syncUrl(); load(false);
    });
    els.tabs.appendChild(b);
  });
  els.day.addEventListener('change', function(){
    state.day = /^\d{4}-\d{2}-\d{2}$/.test(els.day.value) ? els.day.value : '';  // cleared or half-typed -> back to the current slate
    state.openId = null; syncUrl(); load(false);
  });
  els.sort.addEventListener('change', function(){
    state.sort = els.sort.value; syncUrl();
    if (state.games.length) render();       // just reorders what's already loaded, no new request
  });
  els.refresh.addEventListener('click', function(){ load(true); });

  // start from the page URL (?league=mlb&day=2026-09-20&sort=total), falling back to defaults
  (function init(){
    var p = new URLSearchParams(location.search);
    var lg = p.get('league'), day = p.get('day'), sort = p.get('sort');
    if (lg && LEAGUES.some(function(l){ return l.id === lg; })) state.league = lg;
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) state.day = day;
    if (sort && ['ml', 'spread', 'total', 'time'].indexOf(sort) !== -1) state.sort = sort;
    els.day.value = state.day; els.sort.value = state.sort;
    paintTabs(); load(false);
  })();

  // exposed only so the math can be checked from a test page
  window.__lineMoves = { parseAmerican: parseAmerican, impliedProb: impliedProb, fairProbs: fairProbs, parseLine: parseLine, buildGame: buildGame };
})();
