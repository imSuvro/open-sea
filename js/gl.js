'use strict';
// ---------------------------------------------------------------- math
const M = {
  clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
  mix: (a, b, t) => a + (b - a) * t,
  smooth: (a, b, x) => { const t = M.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); },
  v3: {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  },
  perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
  },
  ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
  },
  lookAt(eye, target, up) {
    const z = M.v3.norm(M.v3.sub(eye, target)), x = M.v3.norm(M.v3.cross(up, z)), y = M.v3.cross(z, x), o = new Float32Array(16);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[8] = x[2]; o[9] = y[2]; o[10] = z[2];
    o[12] = -M.v3.dot(x, eye); o[13] = -M.v3.dot(y, eye); o[14] = -M.v3.dot(z, eye); o[15] = 1; return o;
  },
  mul(a, b) { // a*b column-major
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
    } return o;
  },
  inv(m) {
    const o = new Float32Array(16), a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
      a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; d = 1 / d;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d; o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d; o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d; o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d; o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
    return o;
  },
  // 3x3 from column-major mat4 rotation + translation helpers
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  ident() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
};

// ---------------------------------------------------------------- GL context + shader chunks
const SH = {};           // named GLSL chunks, filled by other files
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler3D;\nprecision highp samplerCube;\n';

function resolve(src, seen = {}) {
  return src.replace(/^\s*#include\s+<(\w+)>\s*$/gm, (m, n) => {
    if (seen[n]) return '';
    seen[n] = 1;
    if (!(n in SH)) throw new Error('missing shader chunk ' + n);
    return resolve(SH[n], seen);
  });
}

class GL {
  constructor(canvas) {
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is required');
    this.ext = {
      cbf: gl.getExtension('EXT_color_buffer_float'), lin: gl.getExtension('OES_texture_float_linear'),
      aniso: gl.getExtension('EXT_texture_filter_anisotropic'), dbg: gl.getExtension('WEBGL_debug_renderer_info'),
      par: gl.getExtension('KHR_parallel_shader_compile'), chf: gl.getExtension('EXT_color_buffer_half_float'),
    };
    if (!this.ext.cbf) throw new Error('EXT_color_buffer_float is required');
    this.maxAniso = this.ext.aniso ? Math.min(8, gl.getParameter(this.ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 1;
    this.renderer = this.ext.dbg ? gl.getParameter(this.ext.dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
    // fullscreen triangle + empty vao
    this.vaoEmpty = gl.createVertexArray();
    this.progs = {};
    this.ubo = null;
  }
  program(name, vs, fs, defs = '') {
    const gl = this.gl;
    const d = defs ? defs.split(',').map(x => '#define ' + x.replace('=', ' ')).join('\n') + '\n' : '';
    const mk = (type, src, label) => {
      const s = gl.createShader(type);
      const full = HEADER + d + resolve(src);
      gl.shaderSource(s, full); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        const lines = full.split('\n');
        const m = /ERROR: \d+:(\d+)/.exec(log); let ctx = '';
        if (m) { const n = +m[1]; ctx = lines.slice(Math.max(0, n - 3), n + 2).map((l, i) => (Math.max(0, n - 3) + i + 1) + ': ' + l).join('\n'); }
        throw new Error('[' + name + ' ' + label + '] ' + log + '\n' + ctx);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs, 'vs')); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs, 'fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[' + name + '] link: ' + gl.getProgramInfoLog(p));
    const idx = gl.getUniformBlockIndex(p, 'Globals'); if (idx !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, idx, 0);
    return new Prog(gl, p, name);
  }
  fsProgram(name, fs, defs) { return this.program(name, SH.fsVS, fs, defs); }
  tex2D(w, h, internal, { filter = 'linear', wrap = 'clamp', mips = false, data = null, aniso = false } = {}) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const [format, type] = FMT[internal];
    const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl[internal], w, h);
    if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl[format], gl[type], data);
    const mag = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const min = filter === 'nearest' ? gl.NEAREST : (mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
    const wr = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    if (aniso && this.ext.aniso) gl.texParameterf(gl.TEXTURE_2D, this.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, this.maxAniso);
    return { tex: t, w, h, internal, target: gl.TEXTURE_2D, mips };
  }
  tex3D(w, h, d, internal, { filter = 'linear', wrap = 'repeat', mips = false } = {}) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    const levels = mips ? Math.floor(Math.log2(Math.max(w, h, d))) + 1 : 1;
    gl.texStorage3D(gl.TEXTURE_3D, levels, gl[internal], w, h, d);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wr = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, wr); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, wr);
    return { tex: t, w, h, d, internal, target: gl.TEXTURE_3D, mips };
  }
  cube(size, internal, mips = true) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
    const levels = mips ? Math.floor(Math.log2(size)) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, gl[internal], size, size);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex: t, w: size, h: size, internal, target: gl.TEXTURE_CUBE_MAP, mips, size };
  }
  depthTex(w, h) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex: t, w, h, internal: 'DEPTH_COMPONENT32F', target: gl.TEXTURE_2D };
  }
  // colors: array of tex objects (2D) ; depth: tex object or null
  fbo(colors, depth = null) {
    const gl = this.gl, f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    colors.forEach((c, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c.tex, 0));
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.tex, 0);
    gl.drawBuffers(colors.map((c, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incomplete 0x' + st.toString(16));
    const w = colors[0] ? colors[0].w : depth.w, h = colors[0] ? colors[0].h : depth.h;
    return { fb: f, w, h, n: colors.length };
  }
  bind(f, w, h) {
    const gl = this.gl;
    if (f) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.viewport(0, 0, f.w, f.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); }
  }
  genMips(t) { const gl = this.gl; gl.bindTexture(t.target, t.tex); gl.generateMipmap(t.target); }
  fs() { const gl = this.gl; gl.bindVertexArray(this.vaoEmpty); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  makeUBO(bytes) {
    const gl = this.gl; this.ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo); gl.bufferData(gl.UNIFORM_BUFFER, bytes, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);
  }
  updateUBO(f32) { const gl = this.gl; gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo); gl.bufferSubData(gl.UNIFORM_BUFFER, 0, f32); }
}

const FMT = {
  RGBA32F: ['RGBA', 'FLOAT'], RGBA16F: ['RGBA', 'HALF_FLOAT'], RG16F: ['RG', 'HALF_FLOAT'], R16F: ['RED', 'HALF_FLOAT'],
  RG32F: ['RG', 'FLOAT'], R32F: ['RED', 'FLOAT'], RGBA8: ['RGBA', 'UNSIGNED_BYTE'], R8: ['RED', 'UNSIGNED_BYTE'], RG8: ['RG', 'UNSIGNED_BYTE'],
  R11F_G11F_B10F: ['RGB', 'UNSIGNED_INT_10F_11F_11F_REV'],
};

class Prog {
  constructor(gl, p, name) { this.gl = gl; this.p = p; this.name = name; this.loc = {}; this.unit = 0; }
  use() { this.gl.useProgram(this.p); this.unit = 0; return this; }
  L(n) { let l = this.loc[n]; if (l === undefined) { l = this.loc[n] = this.gl.getUniformLocation(this.p, n); } return l; }
  f(n, v) { const l = this.L(n); if (l !== null) this.gl.uniform1f(l, v); return this; }
  i(n, v) { const l = this.L(n); if (l !== null) this.gl.uniform1i(l, v); return this; }
  v2(n, a, b) { const l = this.L(n); if (l !== null) this.gl.uniform2f(l, a, b); return this; }
  v3(n, a, b, c) { const l = this.L(n); if (l !== null) { if (Array.isArray(a)) this.gl.uniform3f(l, a[0], a[1], a[2]); else this.gl.uniform3f(l, a, b, c); } return this; }
  v4(n, a, b, c, d) { const l = this.L(n); if (l !== null) { if (Array.isArray(a) || a instanceof Float32Array) this.gl.uniform4f(l, a[0], a[1], a[2], a[3]); else this.gl.uniform4f(l, a, b, c, d); } return this; }
  m4(n, m) { const l = this.L(n); if (l !== null) this.gl.uniformMatrix4fv(l, false, m); return this; }
  fv(n, arr) { const l = this.L(n); if (l !== null) this.gl.uniform1fv(l, arr); return this; }
  v3v(n, arr) { const l = this.L(n); if (l !== null) this.gl.uniform3fv(l, arr); return this; }
  v4v(n, arr) { const l = this.L(n); if (l !== null) this.gl.uniform4fv(l, arr); return this; }
  t(n, tex) {
    const l = this.L(n); if (l === null) return this;
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + this.unit); gl.bindTexture(tex.target, tex.tex); gl.uniform1i(l, this.unit++); return this;
  }
}
