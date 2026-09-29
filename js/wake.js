'use strict';
// Yacht wake: 2D wave-equation ripple field + foam trail in a world-anchored window that follows the boat.
// Stability by construction: fixed dt, capped substeps, CFL << 1, hard clamps, absorbing edges, and a NaN/energy guard.

SH.wakeFS = `
#include <common>
in vec2 vUV; out vec4 o;
uniform sampler2D uPrev;
uniform vec2 uOrigin; uniform ivec2 uShift;       // window origin (world) and integer texel shift vs previous
uniform float uTexel, uDt, uC2, uDamp, uHullK;
uniform vec4 uHull;                                // x,z, cos, sin of heading
uniform vec4 uSpeed;                               // speed, heel (signed), rain, sponge
const int N=1024;
vec4 fetchPrev(ivec2 c){ ivec2 q=c+uShift; if(q.x<0||q.y<0||q.x>=N||q.y>=N) return vec4(0.0); return texelFetch(uPrev,q,0); }
void main(){
  ivec2 id=ivec2(gl_FragCoord.xy);
  vec4 c=fetchPrev(id);
  float hL=fetchPrev(id+ivec2(-1,0)).x, hR=fetchPrev(id+ivec2(1,0)).x, hD=fetchPrev(id+ivec2(0,-1)).x, hU=fetchPrev(id+ivec2(0,1)).x;
  float h=c.x, v=c.y, foam=c.z;
  float edgeD=min(min(float(id.x),float(N-1-id.x)),min(float(id.y),float(N-1-id.y)));
  float lap=(hL+hR+hD+hU-4.0*h)/(uTexel*uTexel);
  vec2 p=uOrigin+(vec2(id)+0.5)*uTexel;
  vec2 d=p-uHull.xy; vec2 q=vec2(dot(d,uHull.zw), dot(d,vec2(-uHull.w,uHull.z)));   // q.x forward, q.y starboard
  float sp=uSpeed.x;
  // hull footprint: pressure depression, bow bump
  float e=sq(q.x/6.4)+sq(q.y/1.55);
  float inside=1.0-smoothstep(0.55,1.0,e);
  float bow=exp(-(sq((q.x-5.2)/1.4)+sq(q.y/1.1)));
  float S=sp*sqrt(sp);
  float force=(-0.55*inside+1.15*bow)*S*uHullK;
  // integrate: symplectic Euler, damped
  v+=(uC2*lap-uDamp*v-0.05*h)*uDt+force*uDt;
  v=clamp(v,-6.0,6.0);
  h+=v*uDt; h=clamp(h,-1.5,1.5);
  h=mix(h,(hL+hR+hD+hU)*0.25,0.22);                  // viscous smoothing: kills the 2-texel checkerboard modes
  v=mix(v,(fetchPrev(id+ivec2(-1,0)).y+fetchPrev(id+ivec2(1,0)).y+fetchPrev(id+ivec2(0,-1)).y+fetchPrev(id+ivec2(0,1)).y)*0.25,0.15);
  // absorbing edges
  float edge=min(min(float(id.x),float(N-1-id.x)),min(float(id.y),float(N-1-id.y)));
  float sponge=mix(0.86,1.0,smoothstep(0.0,60.0,edge));
  h*=sponge; v*=sponge;
  // foam: waterline band, bow wash, stern churn, steep wave crests
  float band=smoothstep(0.62,0.9,e)*(1.0-smoothstep(1.0,1.35,e));
  float bowF=exp(-(sq((q.x-5.0)/2.4)+sq(q.y/1.8)));
  float churn=exp(-(sq((q.x+7.2)/2.8)+sq(q.y/1.5)));
  float stamp=max(band*0.85*smoothstep(0.4,1.6,sp),max(bowF*1.2*smoothstep(0.5,1.8,sp),churn*1.25*smoothstep(0.25,1.1,sp)));
  float steep=smoothstep(0.045,0.11,length(vec2(hR-hL,hU-hD))*0.5/uTexel)*smoothstep(3.0,8.0,edgeD);
  stamp=max(stamp,steep*0.55*smoothstep(0.8,3.0,sp));
  float fN=(fetchPrev(id+ivec2(-1,0)).z+fetchPrev(id+ivec2(1,0)).z+fetchPrev(id+ivec2(0,-1)).z+fetchPrev(id+ivec2(0,1)).z)*0.25;
  foam=mix(foam,fN,0.16);
  foam=max(foam*exp(-uDt*0.06),stamp*1.0);
  // NaN / runaway guard
  if(!(abs(h)<10.0)) h=0.0; if(!(abs(v)<50.0)) v=0.0; if(!(foam>=0.0&&foam<=1.5)) foam=0.0;
  o=vec4(h,v,foam,1.0);
}`;

class Wake {
  constructor(g) {
    this.g = g; this.N = 1024; this.extent = 200; this.texel = this.extent / this.N;
    this.prog = g.fsProgram('wake', SH.wakeFS);
    this.tex = [0, 1].map(() => g.tex2D(this.N, this.N, 'RGBA16F', { filter: 'linear', wrap: 'clamp' }));
    this.fbo = this.tex.map(t => g.fbo([t]));
    this.cur = 0; this.origin = [0, 0]; this.acc = 0; this.dtFix = 1 / 60; this.maxSteps = 4;
    this.hullK = 0.13; this.c2 = 1.5 * 1.5; this.damp = 0.55; this.on = true; this.steps = 0; this.guardHits = 0;
    g.bind(this.fbo[0]); g.gl.clearColor(0, 0, 0, 0); g.gl.clear(g.gl.COLOR_BUFFER_BIT);
    g.bind(this.fbo[1]); g.gl.clear(g.gl.COLOR_BUFFER_BIT);
  }
  get heightTex() { return this.tex[this.cur]; }
  update(frameDt, yacht, center) {
    const g = this.g, gl = g.gl;
    // fixed-step accumulator: no matter how uneven frame times are, the solver sees only dtFix
    this.acc = Math.min(this.acc + Math.min(frameDt, 0.1), this.dtFix * this.maxSteps * 1.5);
    let n = 0;
    while (this.acc >= this.dtFix && n < this.maxSteps) { this.step(yacht, center); this.acc -= this.dtFix; n++; }
    this.steps = n;
  }
  step(yacht, center) {
    const g = this.g, gl = g.gl, tx = this.texel;
    const ox = Math.floor((center[0] - this.extent / 2) / tx) * tx, oz = Math.floor((center[1] - this.extent / 2) / tx) * tx;
    const sx = Math.round((ox - this.origin[0]) / tx), sz = Math.round((oz - this.origin[1]) / tx);
    const nxt = this.cur ^ 1;
    g.bind(this.fbo[nxt]); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const fp = yacht.footprint;
    this.prog.use().t('uPrev', this.tex[this.cur]).v2('uOrigin', ox, oz).f('uTexel', tx).f('uDt', this.dtFix).f('uC2', this.c2).f('uDamp', this.damp).f('uHullK', this.hullK)
      .v4('uHull', fp[0], fp[1], fp[2], fp[3]).v4('uSpeed', yacht.speed, 0, 0, 0);
    gl.uniform2i(this.prog.L('uShift'), sx, sz);
    g.fs();
    this.origin = [ox, oz]; this.cur = nxt;
  }
}
