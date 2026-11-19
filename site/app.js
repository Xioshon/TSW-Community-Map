// 夜遊「圍」園 — map viewer: camera (drag, inertia, smooth zoom), stickers, trains, night mode, stamps, story cards.
(async function () {
  const [{ map, places, categories }, lines, walkData, svgText] = await Promise.all([
    fetch("data/places.json").then((r) => r.json()),
    fetch("data/lines.json").then((r) => r.json()).catch(() => ({ loop: [], stations: [] })),
    fetch("data/walk.json").then((r) => r.json()).catch(() => null),
    fetch("img/map.svg").then((r) => r.text()),
  ]);
  const $ = (id) => document.getElementById(id);
  const viewport = $("viewport"), stage = $("stage"), markers = $("markers");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Every place opens a story card; places still waiting for a sticker show a "製作中" frame.
  const real = places;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // ---------- storage + sound ----------
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  let soundOn = store.get("tsw-sound", true);
  let ctx = null;
  const ac = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
  function note(freq, at, dur, { type = "triangle", gain = .14, cutoff = 2600 } = {}) {
    const c = ac(), o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = type; o.frequency.value = freq;
    f.type = "lowpass"; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + .012);
    g.gain.exponentialRampToValueAtTime(.0008, at + dur);
    o.connect(f).connect(g).connect(c.destination);
    o.start(at); o.stop(at + dur + .02);
  }
  const SOUNDS = {
    pop: (t) => note(880, t, .16, { type: "sine", gain: .12 }),
    soft: (t) => note(660, t, .12, { type: "sine", gain: .05 }),
    tick: (t) => note(1320, t, .05, { type: "sine", gain: .025 }),
    land: (t) => { note(392, t, .18, { type: "sine", gain: .1 }); note(587, t + .05, .16, { type: "sine", gain: .06 }); },
    stamp: (t) => { note(110, t, .22, { type: "triangle", gain: .22, cutoff: 600 }); note(220, t, .12, { type: "square", gain: .03, cutoff: 900 }); },
    night: (t) => [784, 659.3, 523.3, 392].forEach((f, i) => note(f, t + i * .11, 1.1, { gain: .11, cutoff: 1900 })),
    day: (t) => [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(f, t + i * .08, .7, { type: "sine", gain: .1 })),
  };
  function play(kind) {
    if (!soundOn) return;
    try { const c = ac(); if (c.state === "suspended") c.resume(); SOUNDS[kind](c.currentTime + .01); } catch { /* no audio */ }
  }

  // ---------- base map ----------
  $("map").innerHTML = svgText;
  $("map").querySelector("svg").setAttribute("aria-hidden", "true");
  stage.style.width = map.width + "px"; stage.style.height = map.height + "px";
  const project = (lat, lon) => [(lon - map.west) * map.kx * map.scale, (map.north - lat) * map.scale];

  lines.stations.forEach((s, i) => {
    const g = Object.assign(document.createElement("span"), { className: "glow" });
    g.style.left = s.x + "px"; g.style.top = s.y + "px";
    g.style.setProperty("--d", (i * .37 % 4).toFixed(2) + "s");
    $("glows").append(g);
  });

  // ---------- markers ----------
  // Structure: .marker > button (still hit area) > .lift (moves on hover/near) > .sticker (sways).
  // Keeping the hit area still stops the hover flicker at a sticker's edge.
  const visited = new Set(store.get("tsw-stamps", []));
  const markerEls = new Map();
  places.forEach((p, i) => {
    const [x, y] = project(p.lat, p.lon);
    const m = document.createElement("div");
    m.className = "marker" + (p.placeholder ? " placeholder" : "") + (visited.has(p.id) ? " visited" : "");
    m.style.left = x + "px"; m.style.top = y + "px";
    m.style.setProperty("--delay", (.25 + i * .12).toFixed(2) + "s");
    m.style.setProperty("--sway", (-Math.random() * 3).toFixed(2) + "s");
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", p.placeholder ? `${p.name}（製作中）` : p.name);
    const lift = Object.assign(document.createElement("span"), { className: "lift" });
    btn.append(lift);
    if (p.placeholder) lift.textContent = "?";
    else lift.append(Object.assign(document.createElement("img"), { className: "sticker", src: p.sticker, alt: "", draggable: false }));
    btn.addEventListener("click", () => openCard(p));
    btn.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") play("tick"); });
    m.append(Object.assign(document.createElement("span"), { className: "pin" }), btn,
      Object.assign(document.createElement("span"), { className: "label", textContent: p.name }));
    markers.append(m);
    markerEls.set(p.id, m);
  });

  // Early feedback: stickers lean up a little as the mouse approaches, before it even touches them.
  let mouse = null, nearQueued = false;
  function updateNear() {
    nearQueued = false;
    for (const m of markerEls.values()) {
      const r = m.querySelector("button").getBoundingClientRect();
      const d = mouse ? Math.hypot(mouse.x - (r.left + r.width / 2), mouse.y - (r.top + r.height / 2)) : 1e9;
      m.style.setProperty("--near", clamp01(1 - (d - r.width * .5) / 140).toFixed(2));
    }
  }
  const queueNear = () => { if (!nearQueued) { nearQueued = true; requestAnimationFrame(updateNear); } };
  viewport.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { mouse = { x: e.clientX, y: e.clientY }; queueNear(); } });
  viewport.addEventListener("pointerleave", () => { mouse = null; queueNear(); });

  // ---------- filters ----------
  const filters = $("filters");
  ["全部", ...categories].forEach((c) => {
    const b = Object.assign(document.createElement("button"), { className: "chip", textContent: c });
    b.setAttribute("aria-pressed", c === "全部");
    b.addEventListener("click", () => {
      play("soft");
      filters.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b));
      b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      places.forEach((p) => markerEls.get(p.id).classList.toggle("dim", c !== "全部" && !(p.tags || []).includes(c)));
    });
    filters.append(b);
  });

  // ---------- stamps ----------
  const renderStamps = () => { $("stamp-count").textContent = `${real.filter((p) => visited.has(p.id)).length}/${real.length}`; };
  renderStamps();
  $("stamps").addEventListener("click", () => {
    const next = real.find((p) => !visited.has(p.id)) || real[0];
    if (next) flyTo(next, () => openCard(next));
  });

  // ---------- camera: one animation loop owns all movement ----------
  let z = 1, tx = 0, ty = 0, minZ = .2;
  const maxZ = 3;
  const vwh = () => [viewport.clientWidth || innerWidth || 800, viewport.clientHeight || innerHeight || 600];
  let settleTimer = 0;
  function render() {
    stage.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${z})`;
    // Only the small marker layer gets the counter-scale variable (setting it on the stage
    // would restyle every node of the inline SVG and drop frames while zooming).
    // Level of detail: stickers stay small (and still) on the overview, then grow, get their
    // names and start swaying once you zoom in; walk memos spell out their names only up close.
    markers.style.setProperty("--k", (Math.min(1.1, Math.max(.52, z)) / z).toFixed(3));
    markers.classList.toggle("detail", z >= .8);
    markers.classList.toggle("close", z >= 1.5);
    stage.classList.add("moving"); // cached layer while moving; redrawn sharp once still
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => stage.classList.remove("moving"), 180);
    if (mouse) queueNear();
  }
  function boundsAt(zz) {
    const [vw, vh] = vwh(), w = map.width * zz, h = map.height * zz, pad = 40;
    return {
      bx: w + 2 * pad < vw ? [(vw - w) / 2, (vw - w) / 2] : [vw - w - pad, pad],
      by: h + 2 * pad < vh ? [(vh - h) / 2, (vh - h) / 2] : [vh - h - pad, pad],
    };
  }
  const lim = (v, [a, b]) => Math.min(b, Math.max(a, v));
  const clampZ = (v) => Math.min(maxZ, Math.max(minZ, v));
  function clampView() { const { bx, by } = boundsAt(z); tx = lim(tx, bx); ty = lim(ty, by); }

  let anim = null, animId = 0;
  function stopAnim() { cancelAnimationFrame(animId); anim = null; }
  function startAnim(a) {
    cancelAnimationFrame(animId);
    anim = { ...a, last: performance.now() };
    animId = requestAnimationFrame(step);
  }
  const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function step(now) {
    if (!anim) return;
    const dt = Math.min(32, now - anim.last), f = dt / 16.67;
    anim.last = now;
    let more = true;
    if (anim.type === "glide") {
      const { bx, by } = boundsAt(z);
      const ox = tx - lim(tx, bx), oy = ty - lim(ty, by);
      if (ox) { anim.vx *= Math.pow(.55, f); tx -= ox * (1 - Math.pow(.8, f)); }
      if (oy) { anim.vy *= Math.pow(.55, f); ty -= oy * (1 - Math.pow(.8, f)); }
      tx += anim.vx * dt; ty += anim.vy * dt;
      anim.vx *= Math.pow(.94, f); anim.vy *= Math.pow(.94, f);
      more = Math.hypot(anim.vx, anim.vy) > .015 || Math.abs(ox) > .5 || Math.abs(oy) > .5;
      if (!more) clampView();
    } else if (anim.type === "tween") {
      const t = clamp01((now - anim.t0) / anim.dur), e = easeInOut(t);
      z = anim.from.z + (anim.to.z - anim.from.z) * e;
      tx = anim.from.tx + (anim.to.tx - anim.from.tx) * e;
      ty = anim.from.ty + (anim.to.ty - anim.from.ty) * e;
      more = t < 1;
      if (!more && anim.done) anim.done();
    } else if (anim.type === "wheel") {
      // Ease toward the target zoom, keeping the point under the cursor fixed.
      const nz = z + (anim.goal - z) * (1 - Math.pow(.72, f));
      tx = anim.ax - ((anim.ax - tx) * nz) / z;
      ty = anim.ay - ((anim.ay - ty) * nz) / z;
      z = nz;
      clampView();
      more = Math.abs(anim.goal - z) / z > .001;
    }
    render();
    if (more) animId = requestAnimationFrame(step); else anim = null;
  }
  // Animate to a view; the target is clamped so the motion ends exactly at rest (no snap afterwards).
  function tweenTo(nz, ntx, nty, dur = 480, done) {
    nz = clampZ(nz);
    const { bx, by } = boundsAt(nz);
    const to = { z: nz, tx: lim(ntx, bx), ty: lim(nty, by) };
    if (reduceMotion) { z = to.z; tx = to.tx; ty = to.ty; render(); done && done(); return; }
    startAnim({ type: "tween", from: { z, tx, ty }, to, t0: performance.now(), dur, done });
  }
  const goalZ = () => (anim && anim.type === "tween" ? anim.to.z : anim && anim.type === "wheel" ? anim.goal : z);
  function zoomAround(nz, cx, cy) {
    // Starts from the current (possibly gliding or mid-tween) view, so it always animates.
    nz = clampZ(nz);
    tweenTo(nz, cx - ((cx - tx) * nz) / z, cy - ((cy - ty) * nz) / z, 380);
  }
  function homeView() {
    const [vw, vh] = vwh();
    minZ = Math.min(vw / map.width, vh / map.height) * .9;
    const hz = clampZ(Math.min(vw / 1150, vh / 1900));
    return [hz, vw / 2 - 800 * hz, vh / 2 - 1080 * hz];
  }
  function flyTo(p, done) {
    const [vw, vh] = vwh(), [x, y] = project(p.lat, p.lon), nz = Math.max(z, 1.1);
    tweenTo(nz, vw / 2 - x * nz, vh / 2 - (y - 60) * nz, 520, done);
  }

  // Drag with rubber-band edges, then glide.
  function dragBy(dx, dy) {
    const { bx, by } = boundsAt(z), MAX = 160;
    tx += dx * (tx < bx[0] || tx > bx[1] ? .35 : 1);
    ty += dy * (ty < by[0] || ty > by[1] ? .35 : 1);
    tx = Math.min(bx[1] + MAX, Math.max(bx[0] - MAX, tx));
    ty = Math.min(by[1] + MAX, Math.max(by[0] - MAX, ty));
    render();
  }
  const pointers = new Map();
  let last = null, moved = 0, vx = 0, vy = 0, lastT = 0;
  viewport.addEventListener("dragstart", (e) => e.preventDefault());
  viewport.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopAnim(); // catch a gliding map
    last = null; moved = 0; vx = vy = 0; lastT = performance.now();
    if (e.pointerType === "mouse" && !e.target.closest("button")) e.preventDefault();
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    if (last && last.n === pts.length) {
      const dx = cx - last.cx, dy = cy - last.cy;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6 && !viewport.classList.contains("dragging")) {
        try { viewport.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        viewport.classList.add("dragging");
      }
      if (pts.length > 1 && last.dist) {
        const nz = clampZ(z * (dist / last.dist));
        tx = cx - ((cx - (tx + dx)) * nz) / z; ty = cy - ((cy - (ty + dy)) * nz) / z; z = nz;
        clampView(); render();
        vx = vy = 0;
      } else {
        dragBy(dx, dy);
        const now = performance.now(), dt = Math.max(1, now - lastT);
        vx = .7 * (dx / dt) + .3 * vx; vy = .7 * (dy / dt) + .3 * vy;
        lastT = now;
      }
    }
    last = { cx, cy, dist, n: pts.length };
  });
  const end = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    last = null;
    if (pointers.size) return;
    viewport.classList.remove("dragging");
    if (performance.now() - lastT > 90) vx = vy = 0;
    startAnim({ type: "glide", vx, vy });
  };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", end);
  viewport.addEventListener("click", (e) => {
    if (moved > 6) { e.stopPropagation(); return; }
    if (e.target.closest("button")) return;
    const r = stage.getBoundingClientRect();
    const dot = Object.assign(document.createElement("span"), { className: "ripple" });
    dot.style.left = (e.clientX - r.left) / z + "px"; dot.style.top = (e.clientY - r.top) / z + "px";
    markers.append(dot);
    setTimeout(() => dot.remove(), 600);
  }, true);
  viewport.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) zoomAround(goalZ() * 1.8, e.clientX, e.clientY); });
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const speed = e.deltaMode === 1 ? .05 : .0018; // lines vs pixels
    const goal = clampZ((anim && anim.type === "wheel" ? anim.goal : z) * Math.exp(-e.deltaY * speed));
    if (anim && anim.type === "wheel") Object.assign(anim, { goal, ax: e.clientX, ay: e.clientY });
    else startAnim({ type: "wheel", goal, ax: e.clientX, ay: e.clientY });
  }, { passive: false });

  const center = () => vwh().map((v) => v / 2);
  $("zoom-in").onclick = () => { play("soft"); zoomAround(goalZ() * 1.45, ...center()); };
  $("zoom-out").onclick = () => { play("soft"); zoomAround(goalZ() / 1.45, ...center()); };
  $("zoom-reset").onclick = () => { play("soft"); tweenTo(...homeView(), 600); };
  addEventListener("resize", () => {
    if (!(z > .01)) { [z, tx, ty] = homeView(); clampView(); return render(); }
    const [vw, vh] = vwh();
    minZ = Math.min(vw / map.width, vh / map.height) * .9;
    clampView(); render();
  });
  [z, tx, ty] = homeView(); clampView(); render();

  // ---------- night walk (easter egg): the team's 2026-11-06 route, drawn when night falls ----------
  const walk = (() => {
    if (!walkData || !walkData.legs.length) return { set() {} };
    const NSW = "http://www.w3.org/2000/svg", svg = $("walk");
    svg.setAttribute("viewBox", `0 0 ${map.width} ${map.height}`);
    const pts = walkData.legs.flatMap((l, i) => (i ? l.pts.slice(1) : l.pts));
    const dOf = (ps) => "M" + ps.map((p) => p.join(",")).join(" L");
    const road = walkData.legs.filter((l) => !l.tunnel).map((l) => dOf(l.pts)).join(" ");
    const tunnel = walkData.legs.filter((l) => l.tunnel).map((l) => dOf(l.pts)).join(" ");
    svg.innerHTML = `<defs><mask id="walk-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="${map.width}" height="${map.height}">
        <path class="walk-mask" d="${dOf(pts)}"/></mask></defs>
      <g mask="url(#walk-reveal)"><path class="walk-glow" d="${road}"/><path class="walk-line" d="${road}"/><path class="walk-tunnel" d="${tunnel}"/></g>
      <circle class="walker-halo" r="26"/><circle class="walker" r="7"/>`;
    const mask = svg.querySelector(".walk-mask"), halo = svg.querySelector(".walker-halo"), dot = svg.querySelector(".walker");
    const total = mask.getTotalLength();
    mask.style.strokeDasharray = `${total} ${total}`;
    // memo-paper stops (HTML, so they keep a readable size at any zoom like the stickers)
    const stops = walkData.stops.map((s, i) => {
      // where a sticker already marks the stop, only a small numbered badge is shown (no clutter)
      const onSticker = places.some((p) => { const [x, y] = project(p.lat, p.lon); return Math.hypot(x - s.x, y - s.y) < 120; });
      const el = Object.assign(document.createElement("div"), { className: "walk-stop" + (i ? "" : " start") + (onSticker ? " badge" : "") });
      el.style.left = s.x + "px"; el.style.top = s.y + "px";
      el.style.setProperty("--tilt", ((i * 37) % 11 - 5) + "deg");
      el.innerHTML = `<span class="memo"><b>${i + 1}</b>${onSticker ? "" : `<i>${s.name}</i>`}</span>`;
      el.title = s.name;
      markers.prepend(el);
      return { el, at: s.at * total };
    });
    const egg = document.querySelector(".title-card .egg");
    if (egg) egg.textContent = `🏮 彩蛋：${walkData.date.slice(5).replace("-", ".")} 我哋嘅夜遊路線 · ${walkData.km} km`;
    let on = false, raf = 0, t0 = 0, last = 0, pos = 0;
    const DRAW = 5200, STROLL = 55; // ms to draw the whole route; walker speed afterwards (map px/s)
    const ease = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    function place(L) {
      const p = mask.getPointAtLength(L);
      for (const c of [halo, dot]) { c.setAttribute("cx", p.x.toFixed(1)); c.setAttribute("cy", p.y.toFixed(1)); }
    }
    function reveal(L) {
      mask.style.strokeDashoffset = total - L;
      stops.forEach((s) => s.el.classList.toggle("show", on && L >= s.at - 1));
    }
    function frame(now) {
      if (!on) return;
      const k = Math.min(1, (now - t0) / DRAW);
      if (k < 1) { pos = ease(k) * total; reveal(pos); }
      else { if (!last) { reveal(total); last = now; } pos = (pos + STROLL * Math.min(.1, (now - last) / 1000)) % total; last = now; }
      place(pos);
      raf = requestAnimationFrame(frame);
    }
    return {
      set(v) {
        on = v; cancelAnimationFrame(raf);
        svg.classList.toggle("on", v);
        if (!v) { stops.forEach((s) => s.el.classList.remove("show")); return; }
        if (reduceMotion) { reveal(total); place(0); return; }
        reveal(0); pos = 0; last = 0; t0 = performance.now();
        raf = requestAnimationFrame(frame);
      },
    };
  })();

  // ---------- night mode ----------
  const nightBtn = $("night");
  function setNight(on, withSound) {
    document.body.classList.toggle("night", on);
    nightBtn.textContent = on ? "☀️" : "🌙";
    nightBtn.setAttribute("aria-pressed", on);
    nightBtn.setAttribute("aria-label", on ? "天光" : "入夜");
    if (withSound) play(on ? "night" : "day");
    walk.set(on);
  }
  nightBtn.onclick = () => { const on = !document.body.classList.contains("night"); setNight(on, true); store.set("tsw-night", on); };
  setNight(store.get("tsw-night", false), false);

  const soundBtn = $("sound");
  function setSound(on) { soundOn = on; soundBtn.textContent = on ? "🔈" : "🔇"; soundBtn.setAttribute("aria-pressed", on); store.set("tsw-sound", on); }
  soundBtn.onclick = () => { setSound(!soundOn); play("soft"); };
  setSound(soundOn);

  // ---------- light rail: a 705 and a 706, two-car sets running the loop non-stop ----------
  const NS = "http://www.w3.org/2000/svg", rails = $("rails");
  rails.setAttribute("viewBox", `0 0 ${map.width} ${map.height}`);
  function carSVG(lead) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "car");
    const wins = [-9.6, -5.6, -1.6, 2.4, 6.4].map((x) =>
      `<rect class="car-win" x="${x}" y="-5.2" width="2.8" height="2" rx=".6"/><rect class="car-win" x="${x}" y="3.2" width="2.8" height="2" rx=".6"/>`).join("");
    g.innerHTML = `<rect class="car-shadow" x="-13" y="-5.5" width="26" height="13" rx="4.5"/>
      <rect class="car-body" x="-13" y="-6.5" width="26" height="13" rx="4.5"/>
      <rect class="car-stripe" x="-11" y="-1.5" width="22" height="3" rx="1.5"/>${wins}` +
      (lead ? `<rect class="car-front" x="9.6" y="-4.6" width="2.6" height="9.2" rx="1.2"/>
        <circle class="car-light" cx="12.4" cy="-3.6" r="1"/><circle class="car-light" cx="12.4" cy="3.6" r="1"/>`
        : `<path class="car-panto" d="M-4 0 L0 -3.4 L4 0 L0 3.4 Z"/>`);
    rails.append(g);
    return g;
  }
  const trains = [];
  if ((lines.loop || []).length > 1) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M" + lines.loop.map((p) => p.join(",")).join(" L"));
    path.setAttribute("fill", "none");
    rails.append(path);
    const len = path.getTotalLength();
    // Same speed, leaving 天水圍 together and running opposite ways round the loop.
    [1, -1].forEach((dir) => trains.push({ path, len, dir, pos: dir > 0 ? .002 : .998, cars: [carSVG(true), carSVG(false)] }));
  }
  const SPEED = 30; // map px per second
  let prev = performance.now();
  const wrap = (L, len) => ((L % len) + len) % len;
  function placeTrain(t) {
    const s = Math.min(1.25, Math.max(.8, 1 / Math.pow(z, .8)));
    t.cars.forEach((g, i) => {
      const L = wrap(t.pos * t.len - t.dir * i * 27.5 * s, t.len);
      const a = t.path.getPointAtLength(L), b = t.path.getPointAtLength(wrap(L + t.dir * 2, t.len));
      g.setAttribute("transform", `translate(${a.x.toFixed(1)},${a.y.toFixed(1)}) rotate(${((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toFixed(1)}) scale(${s.toFixed(2)})`);
    });
  }
  function tick(now) {
    const dt = Math.min(.1, (now - prev) / 1000); prev = now;
    for (const t of trains) { t.pos = wrap(t.pos + (t.dir * SPEED * dt) / t.len, 1); placeTrain(t); }
    requestAnimationFrame(tick);
  }
  trains.forEach(placeTrain);
  if (!reduceMotion && trains.length) requestAnimationFrame(tick);

  // ---------- story card ----------
  const layer = $("card-layer"), backdrop = $("card-backdrop"), card = $("card"), art = $("card-art"),
    sticker = $("card-sticker"), stamp = $("card-stamp");
  let current = null, lastFocus = null, busy = false;
  const EASE_OUT = "cubic-bezier(.3,1.3,.5,1)";
  const rest = "rotate(-1deg)";
  const cardBits = () => [...card.children].filter((el) => el !== art && el !== stamp);
  real.forEach((p) => { if (!p.sticker) return; const i = new Image(); i.src = p.sticker; i.decode && i.decode().catch(() => {}); });
  // a square, transparent stand-in so the card keeps its layout (and flight maths) without a sticker yet
  const BLANK = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420"/>');

  function fromMarker(p) {
    const b = markerEls.get(p.id).querySelector(".lift").getBoundingClientRect();
    const c = card.getBoundingClientRect(), s0 = sticker.getBoundingClientRect();
    const s = Math.max(.05, b.width / s0.width);
    const ccx = c.left + c.width / 2, ccy = c.top + c.height / 2;
    const scx = s0.left + s0.width / 2, scy = s0.top + s0.height / 2;
    return `translate(${b.left + b.width / 2 - (ccx + (scx - ccx) * s)}px, ${b.top + b.height / 2 - (ccy + (scy - ccy) * s)}px) scale(${s}) rotate(-4deg)`;
  }
  function paper(onFirst) {
    const cs = getComputedStyle(card), on = { backgroundColor: cs.backgroundColor, borderColor: cs.borderTopColor, boxShadow: cs.boxShadow };
    const off = { backgroundColor: "rgba(0,0,0,0)", borderColor: "rgba(0,0,0,0)", boxShadow: "none" };
    return onFirst ? [on, off] : [off, on];
  }
  function fill(p) {
    sticker.src = p.sticker || BLANK;
    art.classList.toggle("pending", !p.sticker);
    $("card-title").textContent = p.name;
    $("card-area").textContent = p.area || "";
    $("card-stars").textContent = "★".repeat(p.stars || 0) + "☆".repeat(5 - (p.stars || 0));
    $("card-tags").replaceChildren(...(p.tags || []).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
    $("card-text").textContent = p.text || "";
    const i = real.indexOf(p);
    $("card-prev").disabled = i <= 0;
    $("card-next").disabled = i >= real.length - 1;
  }
  function stampIfNew(p) {
    const first = !visited.has(p.id);
    stamp.classList.remove("slam");
    stamp.classList.toggle("show", !first);
    if (!first) return;
    visited.add(p.id);
    store.set("tsw-stamps", [...visited]);
    markerEls.get(p.id).classList.add("visited");
    void stamp.offsetWidth;
    stamp.classList.add("slam");
    setTimeout(() => {
      play("stamp"); renderStamps();
      const b = $("stamps"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
    }, reduceMotion ? 0 : 650);
  }
  // Fade/slide uses the independent `translate` property, so elements keep their own transform
  // (this is what made the tape jump from off-centre to centre at the end of the animation).
  const bitsIn = (delay) => cardBits().forEach((el) => el.animate([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }],
    { duration: 260, delay, easing: "ease-out", fill: "backwards" }));

  async function openCard(p) {
    if (busy || !layer.hidden) return;
    busy = true;
    lastFocus = document.activeElement;
    current = p;
    const m = markerEls.get(p.id), lift = m.querySelector(".lift");
    play("pop");
    m.classList.add("active");
    fill(p);
    if (reduceMotion) {
      layer.hidden = false; m.classList.add("peeled");
    } else {
      const up = lift.animate([{ transform: getComputedStyle(lift).transform }, { transform: "translateY(-12px) scale(1.18) rotate(-4deg)" }],
        { duration: 150, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" });
      await Promise.all([up.finished.catch(() => {}), sticker.decode ? sticker.decode().catch(() => {}) : 0]);
      layer.hidden = false;
      const from = fromMarker(p), pk = paper(false);
      m.classList.add("peeled");
      up.cancel();
      backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
      card.animate([{ transform: from, ...pk[0] }, { offset: .35, ...pk[0] }, { transform: "rotate(-1deg) scale(1.02)", offset: .78, ...pk[1] }, { transform: rest }],
        { duration: 560, easing: "cubic-bezier(.25,.85,.3,1)" });
      bitsIn(260);
    }
    stampIfNew(p);
    $("card-close").focus({ preventScroll: true });
    busy = false;
  }
  async function closeCard() {
    if (busy || layer.hidden) return;
    busy = true;
    const p = current, m = markerEls.get(p.id), lift = m.querySelector(".lift");
    if (!reduceMotion) {
      const to = fromMarker(p), pk = paper(true);
      backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: "ease-in", fill: "forwards" });
      cardBits().forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-in", fill: "forwards" }));
      stamp.animate([{ opacity: getComputedStyle(stamp).opacity }, { opacity: 0 }], { duration: 140, fill: "forwards" });
      await card.animate([{ transform: rest, ...pk[0] }, { offset: .45, ...pk[1] }, { transform: to, ...pk[1] }],
        { duration: 420, easing: "cubic-bezier(.55,0,.35,1)", fill: "forwards" }).finished.catch(() => {});
    }
    layer.hidden = true;
    m.classList.remove("peeled", "active");
    [backdrop, card, stamp, ...cardBits()].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    if (!reduceMotion) lift.animate([{ transform: "scale(1.1) rotate(-3deg)" }, { transform: "scale(.95) rotate(1deg)", offset: .55 }, { transform: getComputedStyle(lift).transform }],
      { duration: 380, easing: "ease-out" });
    play("land");
    current = null; busy = false;
    lastFocus && lastFocus.focus({ preventScroll: true });
  }
  function switchTo(p, dir) {
    markerEls.get(current.id).classList.remove("peeled", "active");
    current = p;
    markerEls.get(p.id).classList.add("peeled", "active");
    play("soft");
    if (reduceMotion) { fill(p); stampIfNew(p); return; }
    card.animate([{ transform: rest }, { transform: `translateX(${-dir * 40}px) rotate(${-dir * 4}deg)`, opacity: 0 }],
      { duration: 160, easing: "ease-in" }).finished.then(() => {
      fill(p);
      card.animate([{ transform: `translateX(${dir * 40}px) rotate(${dir * 4}deg)`, opacity: 0 }, { transform: rest, opacity: 1 }],
        { duration: 260, easing: EASE_OUT });
      stampIfNew(p);
    });
  }
  $("card-close").onclick = closeCard;
  $("card-prev").onclick = () => { const i = real.indexOf(current); if (i > 0) switchTo(real[i - 1], -1); };
  $("card-next").onclick = () => { const i = real.indexOf(current); if (i < real.length - 1) switchTo(real[i + 1], 1); };
  layer.addEventListener("click", (e) => { if (e.target === layer || e.target === backdrop) closeCard(); });
  addEventListener("keydown", (e) => {
    if (layer.hidden) return;
    if (e.key === "Escape") closeCard();
    if (e.key === "ArrowLeft") $("card-prev").click();
    if (e.key === "ArrowRight") $("card-next").click();
  });
  art.addEventListener("pointermove", (e) => {
    const r = art.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
    sticker.style.setProperty("--ry", (px * 24).toFixed(1) + "deg");
    sticker.style.setProperty("--rx", (-py * 24).toFixed(1) + "deg");
    sticker.style.setProperty("--sx", (-px * 14).toFixed(1) + "px");
  });
  art.addEventListener("pointerleave", () => ["--rx", "--ry", "--sx"].forEach((v) => sticker.style.removeProperty(v)));
})();
