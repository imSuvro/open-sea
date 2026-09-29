'use strict';
// Cinematic tour: camera segments + environment keyframes. Ends by handing control to the user (free-fly).
class Tour {
  constructor(ctx) {
    this.c = ctx; this.active = false; this.time = 0; this.END = 176; this.label = document.getElementById('tour');
    this.pos = null; this.lastLabel = ''; this.syncT = 0; this.struck = {};
    // env keyframes: [t, sea, hour, clouds, rain, lightning]
    this.env = [
      [0, 1.8, 17.86, 0.50, 0, 0], [22, 2.6, 17.35, 0.45, 0, 0], [46, 3.6, 15.2, 0.50, 0, 0], [66, 3.4, 13.4, 0.40, 0, 0], [100, 3.4, 13.4, 0.42, 0, 0],
      [112, 8.4, 15.8, 1.0, 0.75, 0.9], [130, 8.0, 16.0, 1.0, 0.7, 0.9], [142, 3.2, 19.5, 0.35, 0, 0], [152, 2.4, 23.6, 0.22, 0, 0], [162, 2.0, 24.4, 0.20, 0, 0],
      [172, 2.4, 29.55, 0.40, 0, 0], [176, 2.6, 29.9, 0.42, 0, 0]];
    this.segs = [[0, 'GOLDEN HOUR'], [22, 'UNDER SAIL'], [48, 'FROM ABOVE'], [66, 'BENEATH'], [100, 'SQUALL'], [142, 'MOONLIT'], [164, 'FIRST LIGHT'], [176, '']];
  }
  start() { this.active = true; this.time = 0; this.pos = null; this.struck = {}; this.c.setUI(); }
  stop() {
    if (!this.active) return; this.active = false; this.label.style.opacity = 0;
    const c = this.c.cam; c.vel = [0, 0, 0]; this.c.setUI();
  }
  toggle() { if (this.active) this.stop(); else this.start(); }
  seek(t) { this.time = t; this.active = false; this.apply(0, true); }
  update(dt) {
    this.time += dt; this.apply(dt, false);
    if (this.time > this.END) { this.stop(); }
  }
  envAt(t) {
    const E = this.env; if (t <= E[0][0]) return E[0].slice(1);
    for (let i = 1; i < E.length; i++) if (t <= E[i][0]) {
      const a = E[i - 1], b = E[i], f = M.smooth(a[0], b[0], t); const o = [];
      for (let k = 1; k < 6; k++) o.push(M.mix(a[k], b[k], f)); return o;
    }
    return E[E.length - 1].slice(1);
  }
  apply(dt, snap) {
    const { S, cam, world, yacht } = this.c, t = this.time;
    const e = this.envAt(t);
    S.sea = e[0]; S.hour = e[1] % 24; S.clouds = e[2]; S.rain = e[3]; S.lightning = e[4];
    const Lg = world.Lg || computeLighting(S);
    const yp = yacht ? yacht.pos : [30, 240], yh = yacht ? yacht.heading : 0;
    const fwd = [Math.cos(yh), Math.sin(yh)], rgt = [-Math.sin(yh), Math.cos(yh)];
    if (world.camHs === undefined || snap) world.camHs = world.camH || 0;
    world.camHs += ((world.camH || 0) - world.camHs) * (1 - Math.exp(-dt / 0.6));
    const sunAz = Math.atan2(Lg.sunDir[0], Lg.sunDir[2]), moonAz = Math.atan2(Lg.moonDir[0], Lg.moonDir[2]);
    const eas = M.smooth;
    let P, T, above = true;
    if (t < 22) {   // low over the water, towards the sun, yacht in the middle distance
      const u = t / 22, sh = [Math.sin(sunAz), Math.cos(sunAz)];
      const px = yp[0] - sh[0] * 105 + sh[0] * 14 * u + rgt[0] * 6, pz = yp[1] - sh[1] * 105 + sh[1] * 14 * u + rgt[1] * 6;
      P = [px, world.camHs + 1.5, pz];
      const off = -0.34 + 0.16 * u, cy = Math.cos(off), sy = Math.sin(off), dx = sh[0] * cy - sh[1] * sy, dz = sh[0] * sy + sh[1] * cy;   // aim ~20 deg off the sun
      T = [px + dx * 90, world.camHs + 3.0 + 5 * u, pz + dz * 90];
    } else if (t < 48) {   // orbit the yacht under sail
      const u = eas(22, 48, t), a = yh + Math.PI * (0.62 + 0.9 * u), r = M.mix(46, 27, u), hgt = M.mix(3.2, 6.5, u);
      P = [yp[0] + Math.cos(a) * r, world.camHs + hgt, yp[1] + Math.sin(a) * r];
      T = [yp[0], (yacht ? yacht.heave : 0) + 4.6, yp[1]];
    } else if (t < 66) {   // climb: wake, cloud shadows, horizon
      const u = eas(48, 66, t), a = yh + Math.PI * (1.52 + 0.28 * u), r = M.mix(27, 120, u), hgt = M.mix(6.5, 180, Math.pow(u, 1.15));
      P = [yp[0] + Math.cos(a) * r, world.camHs + hgt, yp[1] + Math.sin(a) * r];
      T = [yp[0] + fwd[0] * 30 * u, 2, yp[1] + fwd[1] * 30 * u];
    } else if (t < 100) {   // descend beside the track, plunge, look up at the sun through the surface, then the fish
      if (!this.dive) this.dive = null;
      if (!this.dive || snap && Math.abs(this.dive.t - t) > 40) { this.dive = { p: [yp[0] + fwd[0] * 60 + rgt[0] * 18, yp[1] + fwd[1] * 60 + rgt[1] * 18], t }; }
      const d = this.dive.p; const u1 = eas(66, 78, t);
      if (this.c.opts.fish && world.under !== undefined && this.c.setAnchor) this.c.setAnchor(d);
      let y;
      if (t < 76) y = M.mix(150, 4.5, Math.pow(u1, 0.8));
      else if (t < 82) y = M.mix(4.5, -7.5, eas(76, 82, t));
      else if (t < 92) y = -7.5 - 0.6 * Math.sin((t - 82) * 0.5);
      else y = M.mix(-8, 1.6, eas(92, 99.6, t));
      P = [d[0] + Math.sin(t * 0.07) * 3, (t < 76 ? y + world.camHs * 0 : y), d[1] + (t - 66) * 0.15];
      if (t < 76) { T = [yp[0], 4, yp[1]]; }
      else if (t < 86) { const u = eas(78, 86, t); T = [d[0] + Math.sin(sunAz) * 20 * (1 - u) + 6 * u, M.mix(-7.5 + 21, -9, u), d[1] + Math.cos(sunAz) * 20 * (1 - u) + 30 * u]; }
      else if (t < 92) { T = [d[0] + 10 * Math.sin((t - 86) * 0.2), -10, d[1] + 32]; }
      else { const u = eas(92, 99, t); T = [P[0] + 60 * Math.sin(sunAz + 0.3), M.mix(-9, 18, u), P[2] + 60 * Math.cos(sunAz + 0.3)]; }
      above = t < 76 || t > 97;
    } else if (t < 142) {   // squall, close to the heeling yacht
      const u = eas(100, 142, t), a = yh + Math.PI * (0.55 + 0.35 * u), r = M.mix(38, 30, u), hgt = 2.6;
      P = [yp[0] + Math.cos(a) * r, world.camHs + hgt + 0.4 * Math.sin(t * 0.7), yp[1] + Math.sin(a) * r];
      T = [yp[0] + fwd[0] * 4, (yacht ? yacht.heave : 0) + 6.5 + 2.0 * (1 - u), yp[1] + fwd[1] * 4];
      const strikes = [112, 121, 130];
      strikes.forEach(s => { if (t > s && !this.struck[s] && this.c.strike) { this.struck[s] = 1; this.c.strike(Math.atan2(yp[0] - P[0], yp[1] - P[2]) + (s === 121 ? 0.4 : -0.25)); } });
    } else if (t < 164) {   // moonlit
      const u = eas(142, 164, t), mh = [Math.sin(moonAz), Math.cos(moonAz)];
      P = [yp[0] - mh[0] * 72 + rgt[0] * 8 + mh[0] * 10 * u, world.camHs + 2.0 + 0.4 * u, yp[1] - mh[1] * 72 + rgt[1] * 8 + mh[1] * 10 * u];
      T = [yp[0] + mh[0] * 50, world.camHs + 14 + 20 * u, yp[1] + mh[1] * 50];
    } else {   // first light: rise gently, sun on the horizon
      const u = eas(164, 176, t), sh = [Math.sin(sunAz), Math.cos(sunAz)];
      P = [yp[0] - sh[0] * 60 - rgt[0] * 10, world.camHs + M.mix(2.2, 9, u), yp[1] - sh[1] * 60 - rgt[1] * 10];
      T = [yp[0] + sh[0] * 80, world.camHs + 4 + 10 * u, yp[1] + sh[1] * 80];
    }
    // keep out of the water unless we are supposed to be under
    if (above) P[1] = Math.max(P[1], world.camHs + 0.7);
    if (!this.pos || snap) this.pos = P.slice(); else { const k = 1 - Math.exp(-dt / (t > 66 && t < 100 ? 0.05 : 0.22)); for (let i = 0; i < 3; i++) this.pos[i] += (P[i] - this.pos[i]) * k; }
    cam.pos[0] = this.pos[0]; cam.pos[1] = this.pos[1]; cam.pos[2] = this.pos[2];
    if (this.tgt && !snap) { const k = 1 - Math.exp(-dt / 0.35); for (let i = 0; i < 3; i++) this.tgt[i] += (T[i] - this.tgt[i]) * k; } else this.tgt = T.slice();
    this.c.lookAtTarget(this.tgt);
    // label
    let lab = ''; for (const [s, name] of this.segs) if (t >= s) lab = name;
    const inSeg = t - (this.segs.filter(s => t >= s[0]).pop() || [0])[0];
    if (this.label) { this.label.textContent = lab; this.label.style.opacity = this.active ? (inSeg < 5 ? Math.min(1, inSeg / 1.5) * (inSeg > 3.5 ? (5 - inSeg) / 1.5 : 1) : 0) : 0; }
    this.syncT += dt; if (this.syncT > 0.3) { this.syncT = 0; this.c.setUI(); }
  }
}
