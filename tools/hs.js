(() => { const o = window.__ocean, w = o.waves, gl = w.g.gl, N = w.N; const out = [];
  let tot = 0; const per = [];
  for (let c = 0; c < 4; c++) { // read disp texture level 0 via a temp FBO
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, w.disp[c].tex, 0);
    const buf = new Float32Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, buf);
    let s = 0, s2 = 0; for (let i = 0; i < N * N; i++) { const h = buf[4 * i + 1]; s += h; s2 += h * h; }
    const m = s / (N * N), v = s2 / (N * N) - m * m; per.push(+Math.sqrt(v).toFixed(4)); tot += v; gl.deleteFramebuffer(fb);
  }
  return { sea: w.sea, U: w.U, HsTarget: w.par.Hs, HsMeasured: +(4 * Math.sqrt(tot)).toFixed(3), rmsPerCascade: per, swell: w.par.swellHs }; })()
