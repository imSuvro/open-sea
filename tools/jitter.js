(async () => { const o = window.__ocean; window.__jitter = true;
  await new Promise(r => setTimeout(r, 12000));
  const g = o.wake.g, gl = g.gl, N = 1024; gl.bindFramebuffer(gl.FRAMEBUFFER, o.wake.fbo[o.wake.cur].fb);
  const buf = new Float32Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, buf);
  let hmax = -1e9, hmin = 1e9, vmax = 0, nan = 0; for (let i = 0; i < N * N; i++) { const h = buf[4 * i], v = buf[4 * i + 1]; if (!isFinite(h) || !isFinite(v)) nan++; hmax = Math.max(hmax, h); hmin = Math.min(hmin, h); vmax = Math.max(vmax, Math.abs(v)); }
  window.__jitter = false; return { hmax, hmin, vmax, nan, steps: o.wake.steps, speed: o.yacht.speed, frame: window.__frame }; })()
