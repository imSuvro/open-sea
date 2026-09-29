(async () => { const o = window.__ocean, out = {};
  const key = (k, t) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); return new Promise(r => setTimeout(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); r(); }, t)); };
  out.tourActive0 = o.tour.active; const t0 = o.tour.time;
  await new Promise(r => setTimeout(r, 1500)); out.tourAdvanced = o.tour.time > t0;
  o.tour.time = o.tour.END - 0.5;            // jump to the end: should hand over control by itself
  await new Promise(r => setTimeout(r, 1500)); out.tourActiveAfterEnd = o.tour.active;
  const p0 = o.cam.pos.slice(); await key('w', 1200); out.moved = Math.hypot(o.cam.pos[0] - p0[0], o.cam.pos[1] - p0[1], o.cam.pos[2] - p0[2]);
  const y0 = o.cam.pos[1]; await key('e', 800); out.up = o.cam.pos[1] - y0;
  const c = document.getElementById('c'); const yaw0 = o.cam.yaw;
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 300, pointerId: 1, bubbles: true }));
  c.dispatchEvent(new PointerEvent('pointermove', { clientX: 420, clientY: 300, pointerId: 1, bubbles: true }));
  c.dispatchEvent(new PointerEvent('pointerup', { clientX: 420, clientY: 300, pointerId: 1, bubbles: true }));
  out.yawChanged = o.cam.yaw - yaw0;
  document.getElementById('bStorm').click(); await new Promise(r => setTimeout(r, 300)); out.stormSea = o.S.sea;
  document.getElementById('bDive').click(); await new Promise(r => setTimeout(r, 1500)); out.under = o.world.under; out.camY = o.cam.pos[1]; out.camH = o.world.camH;
  document.getElementById('bYacht').click(); await new Promise(r => setTimeout(r, 1200)); out.yachtDist = Math.hypot(o.cam.pos[0] - o.yacht.pos[0], o.cam.pos[2] - o.yacht.pos[1]);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })); out.uiHidden = document.getElementById('ui').classList.contains('hidden');
  return JSON.stringify(out); })()
