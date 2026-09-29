'use strict';
// Rain streaks (camera-relative, screen-space ribbons) and lightning (bolt geometry + flash timeline).
SH.rainVS = `
#include <common>
layout(location=0) in vec4 aI;                 // random seeds per drop
uniform float uAmount, uWindX, uWindZ;
out float vA; out float vFade;
void main(){
  int id=gl_VertexID; float end=float(id&1), side=float((id>>1)&1)*2.0-1.0;
  // instance data via attribute divisor
  vec3 box=vec3(56.0,34.0,56.0);
  float fall=9.5+2.0*aI.w;
  vec3 rel=vec3(aI.x*box.x, 0.0, aI.y*box.z);
  float y=fract(aI.z-uCam.w*fall/box.y)*box.y;
  vec3 wind=vec3(uWindX,0.0,uWindZ)*(0.12+0.05*aI.w);
  vec3 P=vec3(uCam.x+rel.x, uCam.y-8.0+y, uCam.z+rel.z);
  P.xz+=wind.xz*(y-box.y*0.5);
  // keep the box centred on the camera horizontally (wrap)
  vec2 dxz=P.xz-uCam.xz; dxz=mod(dxz+box.xz*0.5,box.xz)-box.xz*0.5; P.xz=uCam.xz+dxz;
  vec3 vel=vec3(wind.x*4.0,-fall,wind.z*4.0);
  float len=0.028+0.02*aI.w;                                   // shutter
  vec3 A=P, B=P-vel*len;
  vec4 ca=uViewProj*vec4(A,1.0), cb=uViewProj*vec4(B,1.0);
  float dist=length(P-uCam.xyz);
  vFade=1.0-smoothstep(12.0,34.0,dist);
  vA=0.0;
  if(ca.w<0.05||cb.w<0.05||aI.z>uAmount){ gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
  vec2 sa=ca.xy/ca.w*uRes.xy*0.5, sb=cb.xy/cb.w*uRes.xy*0.5; vec2 d=normalize(sb-sa+1e-6); vec2 n=vec2(-d.y,d.x);
  vec4 c=end<0.5?ca:cb;
  float px=0.75+0.5*aI.w;
  vA=vFade*0.13*(0.3+0.7*aI.w*aI.w)*(end<0.5?1.0:0.25);
  gl_Position=vec4(c.xy+n*side*px*uRes.zw*c.w,c.z,c.w);
}`;
SH.rainFS = `
#include <common>
#include <skyLookup>
in float vA; in float vFade; layout(location=0) out vec4 o;
void main(){
  vec3 up=skyView(vec3(0.0,1.0,0.0)); vec3 hz=skyView(normalize(vec3(0.3,0.05,0.9)));
  vec3 col=(up*0.35+hz*0.55)*mix(1.0,0.8,uWx.z)+uSunCol.rgb*0.03+uMoonCol.rgb*0.03+vec3(uMisc.y*0.6);
  o=vec4(col*vA,vA);
}`;

class Rain {
  constructor(g) {
    this.g = g; const gl = g.gl;
    this.prog = g.program('rain', SH.rainVS, SH.rainFS);
    this.N = 9000;
    const seeds = new Float32Array(this.N * 4); for (let i = 0; i < seeds.length; i++) seeds[i] = i % 4 === 2 ? Math.random() : (i % 4 === 3 ? Math.random() : Math.random() * 2 - 1);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
    this.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 2, 1, 1, 2, 3]), gl.STATIC_DRAW);
  }
  draw(sky, amount, wind) {
    if (amount < 0.02) return;
    const g = this.g, gl = g.gl, p = this.prog.use(); sky.bindSkyUniforms(p);
    p.f('uAmount', Math.min(1, amount * 1.0)).f('uWindX', wind[0]).f('uWindZ', wind[1]);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idx);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.N);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }
}

// lightning: schedules strikes, builds a fractal bolt polyline, exposes flash(t) intensity
class Lightning {
  constructor() { this.t = 0; this.next = 6; this.active = false; this.age = 0; this.pts = new Float32Array(64 * 4); this.n = 0; this.flash = 0; this.pulses = []; this.top = [0, 1500, 0]; }
  rnd(a, b) { return a + Math.random() * (b - a); }
  strike(cam, camYaw, cloudBase, forceAzimuth) {
    const az = forceAzimuth ?? (camYaw + this.rnd(-0.9, 0.9)), dist = this.rnd(1800, 5200);
    const x0 = cam[0] + Math.sin(az) * dist, z0 = cam[2] + Math.cos(az) * dist, top = cloudBase * 0.92;
    const pts = [];
    const jag = (a, b, depth, w, list, off) => {
      if (depth === 0) { list.push([b[0], b[1], b[2], w]); return; }
      const m = [(a[0] + b[0]) / 2 + this.rnd(-1, 1) * off, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + this.rnd(-1, 1) * off];
      jag(a, m, depth - 1, w, list, off * 0.55); jag(m, b, depth - 1, w, list, off * 0.55);
    };
    const A = [x0 + this.rnd(-300, 300), top, z0 + this.rnd(-300, 300)], B = [x0 + this.rnd(-200, 200), 0, z0 + this.rnd(-200, 200)];
    const main = [[A[0], A[1], A[2], 1]]; jag(A, B, 4, 1, main, 260);   // 17 points
    main.forEach(p => pts.push(p));
    // branches
    for (let k = 0; k < 4 && pts.length < 56; k++) {
      const s = main[Math.floor(this.rnd(3, 14))]; const dir = [this.rnd(-1, 1) * 700, -this.rnd(500, 1100), this.rnd(-1, 1) * 700];
      const E = [s[0] + dir[0], Math.max(s[1] + dir[1], 40), s[2] + dir[2]];
      const br = [[s[0], s[1], s[2], -1]]; jag(s, E, 3, 0.3, br, 160);
      br.forEach(p => pts.push(p));
    }
    this.n = Math.min(pts.length, 64); for (let i = 0; i < this.n; i++) this.pts.set(pts[i], i * 4);
    this.top = A; this.active = true; this.age = 0;
    const base = this.rnd(0.9, 1.15); this.pulses = [[0, base], [this.rnd(0.07, 0.11), base * 0.55], [this.rnd(0.16, 0.24), base * 0.95], [this.rnd(0.3, 0.42), base * 0.4]];
  }
  update(dt, S, cam, camYaw, cloudBase, world) {
    this.t += dt;
    const rate = S.lightning * (0.3 + S.storm);
    if (rate > 0.05 && !this.active) { this.next -= dt * rate; if (this.next <= 0) { this.strike(cam, camYaw, cloudBase); this.next = this.rnd(5, 16); } }
    if (this.active) {
      this.age += dt; let f = 0;
      for (const [t0, a] of this.pulses) if (this.age >= t0) f += a * Math.exp(-(this.age - t0) / 0.055) * (0.75 + 0.25 * Math.sin(this.age * 90));
      this.flash = Math.max(0, f);
      if (this.age > 0.9) { this.active = false; this.flash = 0; this.n = 0; }
    } else this.flash = 0;
    world.flash = this.flash;
  }
}
