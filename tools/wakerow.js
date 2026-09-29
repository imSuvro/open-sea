(() => { const o = window.__ocean, g = o.wake.g, gl = g.gl, N = 1024;
  gl.bindFramebuffer(gl.FRAMEBUFFER, o.wake.fbo[o.wake.cur].fb);
  const buf = new Float32Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, buf);
  // find the row/col of max foam near centre, print 24 h values in a row and a column
  let best = 0, bx = 0, by = 0; for (let y = 200; y < 800; y++) for (let x = 200; x < 800; x++) { const f = buf[4 * (y * N + x) + 2]; if (f > best) { best = f; bx = x; by = y; } }
  const row = [], col = []; for (let k = 0; k < 24; k++) { row.push(+(buf[4 * (by * N + bx - 40 + k)] * 1000).toFixed(2)); col.push(+(buf[4 * ((by - 40 + k) * N + bx)] * 1000).toFixed(2)); }
  return { bx, by, row, col }; })()
