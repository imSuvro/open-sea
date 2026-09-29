'use strict';
(function () {
  const Q = new URLSearchParams(location.search);
  const qn = (k, d) => Q.has(k) ? parseFloat(Q.get(k)) : d;
  const STILL = Q.has('still');
  const canvas = document.getElementById('c');
  const $ = id => document.getElementById(id);

  function fail(e) {
    console.error('FATAL ' + (e && e.stack || e));
    const m = $('msg'); m.style.display = 'flex'; m.textContent = 'This needs a WebGL2 browser with float render targets.\n' + (e && e.message || e);
  }

  // ------------------------------------------------------------------ state
  const S = {
    sea: qn('sea', 3), hour: qn('hour', 18.2), clouds: qn('clouds', 0.45), rain: qn('rain', 0), lightning: qn('lightning', 0),
    storm: 0, haze: 0,
  };
  const cam = { pos: [0, 3.2, 0], yaw: 0, pitch: 0, fov: qn('fov', 52) * Math.PI / 180, vel: [0, 0, 0], speed: 1.0 };
  if (Q.has('cam')) { const c = Q.get('cam').split(',').map(Number); cam.pos = [c[0], c[1], c[2]]; cam.yaw = (c[3] || 0) * Math.PI / 180; cam.pitch = (c[4] || 0) * Math.PI / 180; }
  const world = { t: qn('t', 100), simT: 0, frame: 0, drift: [0, 0], expLog: null, under: false, camH: 0, flash: 0 };
  const stats = window.__stats = { fps: 0 };
  window.__S = S; window.__cam = cam; window.__world = world;
  const opts = { yacht: qn('yacht', 1) > 0, fish: qn('fish', 1) > 0 };

  let g, waves, sky, water, post, hdr, yacht, wake, under, rain, tour, lightning;
  let rs = qn('rs', 1.0), dprCap = 2, qMode = Q.has('rs') ? 'fixed' : 'auto', ftEma = 1 / 60, qTimer = 0;

  function deriveState() {
    S.storm = M.clamp(0.75 * S.rain + 0.42 * M.smooth(0.8, 1.0, S.clouds) + 0.16 * M.smooth(6, 10, S.sea) + 0.2 * S.lightning, 0, 1);
  }

  // ------------------------------------------------------------------ resize / targets
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const W = Math.max(64, Math.floor(canvas.clientWidth * dpr)), H = Math.max(64, Math.floor(canvas.clientHeight * dpr));
    canvas.width = W; canvas.height = H;
    const w = Math.max(64, Math.floor(W * rs)), h = Math.max(64, Math.floor(H * rs));
    if (hdr && hdr.w === w && hdr.h === h) return;
    const gl = g.gl;
    if (hdr) { gl.deleteTexture(hdr.color.tex); gl.deleteTexture(hdr.depth.tex); gl.deleteFramebuffer(hdr.fbo.fb); }
    const color = g.tex2D(w, h, 'RGBA16F'), depth = g.depthTex(w, h);
    hdr = { w, h, color, depth, fbo: g.fbo([color], depth) };
    post.resize(w, h);
    if (under) under.resize(w, h);
  }

  // ------------------------------------------------------------------ camera
  function camMatrices(aspect) {
    const cp = Math.cos(cam.pitch), fwd = [Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp];
    const V = M.lookAt(cam.pos, M.v3.add(cam.pos, fwd), [0, 1, 0]);
    const P = M.perspective(cam.fov, aspect, 0.15, 4.0e5);
    const VP = M.mul(P, V);
    return { V, P, VP, IVP: M.inv(VP), fwd };
  }
  const input = { keys: {}, drag: false, lx: 0, ly: 0 };
  function camFwd() { const cp = Math.cos(cam.pitch); return [Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp]; }
  function lookAtTarget(t) {
    const d = M.v3.sub(t, cam.pos); cam.yaw = Math.atan2(d[0], d[2]); cam.pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  }
  function updateFly(dt) {
    const k = input.keys; const f = camFwd(), r = M.v3.norm(M.v3.cross(f, [0, 1, 0]));
    let mv = [0, 0, 0];
    const add = (v, s) => { mv = M.v3.add(mv, M.v3.mul(v, s)); };
    if (k['w'] || k['arrowup']) add(f, 1); if (k['s'] || k['arrowdown']) add(f, -1);
    if (k['d'] || k['arrowright']) add(r, 1); if (k['a'] || k['arrowleft']) add(r, -1);
    if (k['e'] || k[' ']) add([0, 1, 0], 1); if (k['q'] || k['c']) add([0, 1, 0], -1);
    const alt = Math.max(cam.pos[1], 0.5), base = (5 + 0.5 * alt) * cam.speed * (k['shift'] ? 5 : 1) * (k['control'] ? 0.2 : 1);
    const len = M.v3.len(mv); if (len > 0) mv = M.v3.mul(mv, base / len);
    const a = 1 - Math.exp(-dt * 6);
    for (let i = 0; i < 3; i++) cam.vel[i] += (mv[i] - cam.vel[i]) * a;
    for (let i = 0; i < 3; i++) cam.pos[i] += cam.vel[i] * dt;
    cam.pos[1] = M.clamp(cam.pos[1], -300, 9000);
    if (Math.hypot(cam.pos[0], cam.pos[2]) > 600000) { cam.pos[0] *= 0.99; cam.pos[2] *= 0.99; }
  }

  // ------------------------------------------------------------------ per-frame environment
  function updateEnvironment(dt) {
    deriveState();
    const Lg = computeLighting(S);
    if (world.expLog === null || STILL) world.expLog = Lg.target;
    else world.expLog += (Lg.target - world.expLog) * (1 - Math.exp(-dt / 1.3));
    const exposure = Math.exp(world.expLog);
    const C = lightColors(Lg, exposure, S);
    world.Lg = Lg; world.C = C; world.exposure = exposure;
    const sunEl = Math.asin(Lg.sinS) * 180 / Math.PI;
    const nightAmt = 1 - M.smooth(-14, -3, sunEl);
    const moonBright = Lg.moonFrac * Lg.moonFrac * M.smooth(-0.05, 0.3, Lg.sinM);
    const starVis = nightAmt * (1 - 0.6 * moonBright) * (1 - 0.92 * S.clouds);
    const night = [0.0042, 0.0070, 0.0150].map(v => v * nightAmt * (1 - 0.35 * moonBright) * (1 - 0.6 * S.clouds));
    world.nightAmt = nightAmt;
    gset('uSunDir', [...Lg.sunDir, Lg.sinS]); gset('uSunCol', [...C.sunE, exposure]);
    gset('uMoonDir', [...Lg.moonDir, Lg.sinM]); gset('uMoonCol', [...C.moonE, Lg.moonFrac]);
    gset('uCSun', [...C.csunE, 0]); gset('uCMoon', [...C.cmoonE, 0]);
    gset('uWx', [S.clouds, S.rain, S.storm, S.haze]);
    const wd = waves.windDir(); gset('uWind', [wd[0], wd[1], waves.U || 5, S.sea]);
    world.cloudBase = M.mix(1500, 650, S.storm);
    gset('uCloud', [M.mix(1500, 650, S.storm), M.mix(1300, 3200, S.storm), M.clamp(S.storm * 1.1 + 0.6 * M.smooth(0.85, 1.0, S.clouds), 0, 1), 1]);
    const dr = 3 + 0.5 * (waves.U || 5);
    world.drift[0] += wd[0] * dr * dt; world.drift[1] += wd[1] * dr * dt;
    gset('uDrift', [world.drift[0], world.drift[1], 0, 0]);
    gset('uNight', [...night, starVis]);
    world.fogVis = 70000 / (1 + 8 * S.rain + 3 * S.storm + 3 * S.haze);
  }

  function fillFrameGlobals(dt, mats, W, H) {
    gset('uViewProj', mats.VP); gset('uInvViewProj', mats.IVP); gset('uView', mats.V);
    gset('uCam', [cam.pos[0], cam.pos[1], cam.pos[2], world.simT % 4096]);
    gset('uMisc', [world.under ? 1 : 0, world.flash || 0, dt, world.frame % 4096]);
    gset('uRes', [W, H, 1 / W, 1 / H]);
    gset('uFog', [world.fogVis, qn('dbg', 0), 1 / Math.tan(cam.fov / 2), 0]);
    g.updateUBO(GBUF);
  }

  // ------------------------------------------------------------------ frame
  let lastT = 0, fpsAcc = 0, fpsN = 0;
  function frame(now) {
    now *= 0.001;
    let dt = lastT ? Math.min(now - lastT, 0.1) : 1 / 60; lastT = now;
    if (STILL) dt = 0;
    if (window.__jitter) dt = Math.min(0.1, dt * (0.2 + 3.8 * Math.random() * Math.random()));   // stress test: uneven frame times
    render(dt, now);
    if (!STILL && qMode === 'auto' && lastT) { const real = Math.min(0.2, now - (frame.p2 || now)); ftEma += (real - ftEma) * 0.08; qTimer += real;
      if (qTimer > 1.5) { qTimer = 0; if (ftEma > 1 / 27 && rs > 0.56) rs = Math.max(0.55, rs - 0.09); else if (ftEma < 1 / 52 && rs < 1.0) rs = Math.min(1.0, rs + 0.05); } }
    frame.p2 = now;
    fpsAcc += now - (frame.prev || now); fpsN++; frame.prev = now;
    if (fpsAcc > 0.5) { stats.fps = Math.round(fpsN / fpsAcc); $('fps').textContent = stats.fps + ' fps'; fpsAcc = 0; fpsN = 0; }
    window.__frame = ++world.frame;
    requestAnimationFrame(frame);
  }

  function render(dt, now) {
    const gl = g.gl;
    resize();
    if (!STILL) world.simT += dt; else world.simT = world.t;
    updateEnvironment(dt);
    waves.setSea(S.sea);
    waves.update(world.simT + 1000);
    waves.updateFoam(dt, [cam.pos[0], cam.pos[2]]); waves.updateFoamFar(dt, [cam.pos[0], cam.pos[2]]);
    // camera
    if (tour && tour.active) tour.update(dt); else if (!STILL) updateFly(dt);
    // yacht + wake
    if (opts.yacht) {
      yacht.update(dt, waves.windDir(), waves.U || 5, waves, S.sea);
      wake.update(dt, yacht, yacht.pos);
    }
    const pts = opts.yacht ? yacht.probePts.slice() : [];
    pts.push([cam.pos[0], cam.pos[2]]);
    waves.probe(pts);
    const camProbe = opts.yacht ? 5 : 0;
    if (waves.probeValid) { world.camH = waves.height(camProbe); }
    const under0 = world.under;
    world.under = cam.pos[1] < world.camH - (under0 ? -0.02 : 0.02) && cam.pos[1] < 60;
    if (world.under && !under0 && under && !(tour && tour.active)) { const f = camFwd(); under.anchor = [cam.pos[0] + f[0] * 22, cam.pos[2] + f[2] * 22]; }
    lightning.update(dt, S, cam.pos, cam.yaw, world.cloudBase || 1200, world);
    sky.bolt.set(lightning.pts); sky.boltN = lightning.n; sky.flashPos = [lightning.top[0], lightning.top[1], lightning.top[2], lightning.flash];
    sky.update(S, { sunDir: world.Lg.sunDir, moonDir: world.Lg.moonDir, skyE0: world.C.skyE0, skyE1: world.C.skyE1 });
    const aspect = hdr.w / hdr.h;
    const mats = camMatrices(aspect);
    fillFrameGlobals(dt, mats, hdr.w, hdr.h);
    sky.cloudQ = M.clamp(0.5 + rs * 0.5, 0.65, 1.0);
    sky.renderEnv(cam.pos, !STILL);
    if (opts.yacht) {
      const Ld = world.Lg.sinS > 0.0 ? world.Lg.sunDir : world.Lg.moonDir;
      yacht.renderShadow(Ld);
    }
    // main pass
    g.bind(hdr.fbo);
    gl.clearColor(0, 0, 0, 1e5); gl.clearDepth(1.0); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!world.under) sky.drawSky(cam.pos);
    if (opts.yacht) { yacht.draw(sky, waves); yacht.drawLines(sky); }
    if (world.under && under) under.drawFish(sky);
    water.draw(waves, sky, null, cam.pos, 1.0, opts.yacht ? { on: true, heightTex: wake.heightTex, origin: wake.origin, extent: wake.extent } : null);
    if (!world.under) rain.draw(sky, S.rain, [waves.windDir()[0] * (waves.U || 5), waves.windDir()[1] * (waves.U || 5)]);
    if (world.under && under) under.draw(hdr, sky, waves, cam);
    post.run(hdr.color, canvas.width, canvas.height, rs, null);
  }

  // ------------------------------------------------------------------ input
  function bindInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase(); input.keys[k] = true;
      if (['w', 'a', 's', 'd', 'q', 'e', ' ', 'shift', 'control', 'c'].includes(k) || k.startsWith('arrow')) takeControl();
      if (k === 'h') toggleUI();
      if (k === 't') tour && tour.toggle();
      if (e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', e => { input.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { input.keys = {}; });
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId); input.drag = true; input.lx = e.clientX; input.ly = e.clientY; canvas.classList.add('drag');
    });
    canvas.addEventListener('pointermove', e => {
      if (!input.drag) return;
      const dx = e.clientX - input.lx, dy = e.clientY - input.ly; input.lx = e.clientX; input.ly = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 0) takeControl();
      cam.yaw -= dx * 0.0022 * (cam.fov / 0.9); cam.pitch = M.clamp(cam.pitch - dy * 0.0022 * (cam.fov / 0.9), -1.55, 1.55);
    });
    const up = e => { input.drag = false; canvas.classList.remove('drag'); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.speed = M.clamp(cam.speed * Math.exp(-e.deltaY * 0.0012), 0.05, 40); }, { passive: false });
    window.addEventListener('resize', () => resize());
  }
  function takeControl() { if (tour && tour.active) tour.stop(); }
  let uiHidden = false;
  function toggleUI(force) {
    uiHidden = force === undefined ? !uiHidden : force;
    $('ui').classList.toggle('hidden', uiHidden); $('pill').style.display = uiHidden ? 'block' : 'none';
    $('hint').style.opacity = uiHidden ? 0 : 1;
  }

  // ------------------------------------------------------------------ init
  function init() {
    try {
      g = new GL(canvas);
      g.makeUBO(GBUF.byteLength);
      waves = new Waves(g, qn('N', 256)); sky = new Sky(g); water = new Water(g); post = new Post(g);
      if (typeof Under !== 'undefined') under = new Under(g, opts);
      rain = new Rain(g); lightning = new Lightning();
      if (opts.yacht) { yacht = new Yacht(g); wake = new Wake(g); }
      if (typeof Tour !== 'undefined') tour = new Tour({ S, cam, world, waves, yacht, lookAtTarget, setAnchor: p => { if (under) under.anchor = p.slice(); }, strike: az => lightning.strike(cam.pos, cam.yaw, world.cloudBase || 1200, az), camH: () => world.camH, setUI: () => window.__sync && window.__sync(), toggleUI, opts });
      if (Q.has('wind')) waves.windAng = qn('wind', 0.55) * Math.PI / 180;
      if (Q.has('fthr')) waves.foamThr = qn('fthr', 0.32);
      if (Q.has('fbias')) waves.farBias = qn('fbias', 0.1);
      console.log('renderer: ' + g.renderer);
      resize();
      if (Q.has('look')) { deriveState(); const Lg = computeLighting(S); const d = Q.get('look') === 'moon' ? Lg.moonDir : Lg.sunDir; cam.yaw = Math.atan2(d[0], d[2]) + qn('ly', 0) * Math.PI / 180; cam.pitch = Math.asin(d[1]) + qn('lp', 0) * Math.PI / 180; }
      if (STILL) {
        if (Q.has('tour') && tour) tour.seek(qn('tour', 0));      // apply the tour's environment first so the boat settles on the right sea
        deriveState(); waves.setSea(S.sea);
        const warm = qn('warm', 30), step = 0.25;
        for (let s = -warm; s <= 0; s += step) { waves.update(world.t + 1000 + s); waves.updateFoam(step, [cam.pos[0], cam.pos[2]]); waves.updateFoamFar(step, [cam.pos[0], cam.pos[2]]); waves.farTick = 0; }
        if (opts.yacht) {
          yacht.s = qn('ys', 60); yacht.speed = 3.0; const wd = waves.windDir();
          const U = waves.U || 5; const seconds = qn('ywarm', 25);
          waves.update(world.t + 1000);
          for (let k = 0; k < seconds * 60; k++) { yacht.update(1 / 60, wd, U, waves, S.sea); wake.step(yacht, yacht.pos); if (k % 6 === 0) waves.probeBlocking(yacht.probePts); }
          for (let k = 0; k < 240; k++) { yacht.update(1 / 30, wd, U, waves, S.sea); waves.probeBlocking(yacht.probePts); yacht.s -= yacht.speed / 30; }
          if (Q.has('at')) {
            if (Q.get('at') === 'yacht' && Q.has('rel')) { const r = Q.get('rel').split(',').map(Number); cam.pos = [yacht.pos[0] + r[0], r[1], yacht.pos[1] + r[2]]; }
            lookAtTarget(Q.get('at') === 'yacht' ? [yacht.pos[0], qn('aty', 4), yacht.pos[1]] : Q.get('at').split(',').map(Number));
          }
        }
        if (Q.has('tour') && tour) tour.seek(qn('tour', 0));
        if (Q.has('strike')) { deriveState(); lightning.strike(cam.pos, cam.yaw, M.mix(1500, 650, S.storm), cam.yaw + qn('strike', 0) * Math.PI / 180); lightning.age = qn('sage', 0.0); }
      } else {
        toggleUI(false);
        if (tour && !Q.has('notour')) tour.start();
      }
      bindUI(); bindInput();
      if (Q.has('hideui')) { $('ui').style.display = 'none'; $('hint').style.display = 'none'; $('tour').style.display = 'none'; }
      window.__ocean = { S, cam, world, waves, sky, water, yacht, wake, tour, opts, lookAtTarget, under, rain, lightning, g };
      requestAnimationFrame(frame);
    } catch (e) { fail(e); }
  }

  // ------------------------------------------------------------------ UI
  const fmtHour = h => { const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
  const SEA_NAMES = ['Glassy', 'Ripples', 'Wavelets', 'Gentle', 'Moderate', 'Fresh', 'Strong', 'Near gale', 'Gale', 'Severe', 'Storm', 'Violent', 'Hurricane'];
  function bindUI() {
    const sync = () => {
      $('sea').value = S.sea; $('hour').value = S.hour; $('clouds').value = S.clouds; $('rain').value = S.rain; $('lightning').value = S.lightning;
      $('seaO').textContent = 'F' + Math.round(S.sea) + ' ' + SEA_NAMES[Math.round(S.sea)].slice(0, 6);
      $('hourO').textContent = fmtHour(S.hour); $('cloudsO').textContent = Math.round(S.clouds * 100) + '%';
      $('rainO').textContent = Math.round(S.rain * 100) + '%'; $('lightningO').textContent = Math.round(S.lightning * 100) + '%';
      const b = $('bTour'); if (b) b.classList.toggle('on', !!(tour && tour.active));
    };
    window.__sync = sync;
    ['sea', 'hour', 'clouds', 'rain', 'lightning'].forEach(k => $(k).addEventListener('input', () => { S[k] = parseFloat($(k).value); takeControl(); sync(); }));
    const set = (o) => { takeControl(); Object.assign(S, o); sync(); };
    $('bTour').onclick = () => { tour && tour.toggle(); sync(); };
    $('bCalm').onclick = () => set({ sea: 0.6, clouds: 0.25, rain: 0, lightning: 0, hour: 9.5 });
    $('bNight').onclick = () => set({ sea: 2, clouds: 0.2, rain: 0, lightning: 0, hour: 0.5 });
    $('bStorm').onclick = () => set({ sea: 9, clouds: 1, rain: 0.85, lightning: 0.8, hour: 15.5 });
    $('bYacht').onclick = () => { takeControl(); if (yacht) { const p = yacht.pos; cam.pos = [p[0] - 26, Math.max(6, world.camH + 6), p[1] - 22]; lookAtTarget([p[0], 5, p[1]]); } };
    $('bDive').onclick = () => { takeControl(); cam.pos[1] = Math.min(cam.pos[1], world.camH - 6); cam.pitch = Math.min(cam.pitch, 0.12); world.under = true; };
    const qm = ['auto', 'perf', 'ultra'], qn2 = { auto: 'Quality: Auto', perf: 'Quality: Low', ultra: 'Quality: Ultra' };
    $('bQ').onclick = () => { qMode = qm[(qm.indexOf(qMode) + 1) % 3]; if (qMode === 'perf') rs = 0.62; else if (qMode === 'ultra') rs = 1.5; else rs = 1.0; $('bQ').textContent = qn2[qMode]; };
    $('bQ').textContent = qMode === 'fixed' ? 'Quality: Fixed' : qn2[qMode];
    $('bHide').onclick = () => toggleUI(true); $('pill').onclick = () => toggleUI(false);
    sync();
  }

  { const t = $('tour'); t.textContent = 'PREPARING SEA'; t.style.opacity = 1; }
  requestAnimationFrame(() => setTimeout(() => { init(); if (tour && !tour.active) $('tour').style.opacity = 0; }, 40));
})();
