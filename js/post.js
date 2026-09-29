'use strict';
SH.bloomDownFS = `
#include <common>
in vec2 vUV; out vec4 o; uniform sampler2D uSrc; uniform vec2 uTexel; uniform int uFirst;
vec3 sm(vec3 c){ return c/(1.0+max(c.r,max(c.g,c.b))/24.0); }
vec3 S(vec2 uv){ vec3 c=texture(uSrc,uv).rgb; return uFirst==1?sm(c):c; }
void main(){
  vec2 uv=vUV, t=uTexel;
  vec3 a=S(uv+t*vec2(-2,2)), b=S(uv+t*vec2(0,2)), c=S(uv+t*vec2(2,2));
  vec3 d=S(uv+t*vec2(-2,0)), e=S(uv), f=S(uv+t*vec2(2,0));
  vec3 g=S(uv+t*vec2(-2,-2)), h=S(uv+t*vec2(0,-2)), i=S(uv+t*vec2(2,-2));
  vec3 j=S(uv+t*vec2(-1,1)), k=S(uv+t*vec2(1,1)), l=S(uv+t*vec2(-1,-1)), m=S(uv+t*vec2(1,-1));
  o=vec4(e*0.125+(a+c+g+i)*0.03125+(b+d+f+h)*0.0625+(j+k+l+m)*0.125,1.0);
}`;
SH.bloomUpFS = `
#include <common>
in vec2 vUV; out vec4 o; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uW;
void main(){
  vec2 uv=vUV, t=uTexel;
  vec3 s=texture(uSrc,uv).rgb*4.0;
  s+=texture(uSrc,uv+t*vec2(-1,0)).rgb*2.0+texture(uSrc,uv+t*vec2(1,0)).rgb*2.0+texture(uSrc,uv+t*vec2(0,-1)).rgb*2.0+texture(uSrc,uv+t*vec2(0,1)).rgb*2.0;
  s+=texture(uSrc,uv+t*vec2(-1,-1)).rgb+texture(uSrc,uv+t*vec2(1,-1)).rgb+texture(uSrc,uv+t*vec2(-1,1)).rgb+texture(uSrc,uv+t*vec2(1,1)).rgb;
  o=vec4(s/16.0*uW,1.0);
}`;
SH.tonemapFS = `
#include <common>
in vec2 vUV; out vec4 o;
uniform sampler2D uHdr, uBloom; uniform float uBloomAmt, uSS, uGrainAmt, uSat; uniform vec2 uTexel; uniform vec2 uRes2;
vec3 aces(vec3 v){
  const mat3 IN=mat3(0.59719,0.07600,0.02840,0.35458,0.90834,0.13383,0.04823,0.01566,0.83777);
  const mat3 OUT=mat3(1.60475,-0.10208,-0.00327,-0.53108,1.10813,-0.07276,-0.07367,-0.00605,1.07602);
  v=IN*v; vec3 a=v*(v+0.0245786)-0.000090537; vec3 b=v*(0.983729*v+0.4329510)+0.238081; return OUT*(a/b);
}
vec3 srgb(vec3 c){ return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(0.0031308,c)); }
void main(){
  vec2 uv=vUV;
  vec3 c;
  if(uSS>1.05){ vec2 t=uTexel*0.5*uSS*0.5; c=0.25*(texture(uHdr,uv+t*vec2(-1,-1)).rgb+texture(uHdr,uv+t*vec2(1,-1)).rgb+texture(uHdr,uv+t*vec2(-1,1)).rgb+texture(uHdr,uv+t*vec2(1,1)).rgb); }
  else c=texture(uHdr,uv).rgb;
  c=min(c,vec3(40000.0));
  // soft-clamp huge values per channel before averaging artefacts (fireflies) but keep bright discs
  vec3 bl=texture(uBloom,uv).rgb;
  c+=bl*uBloomAmt;
  float l=lum(c); c=mix(vec3(l),c,uSat);
  c=aces(c*1.0);
  c=clamp(c,0.0,1.0);
  float l2=lum(c); c=mix(vec3(l2),c,1.08);                    // gentle re-saturation after the filmic desaturation
  c=clamp(c,0.0,1.0); c=mix(c,c*c*(3.0-2.0*c),0.28);          // mild S-curve contrast
  vec2 q=uv-0.5; float vig=1.0-0.28*dot(q,q)*2.2; c*=vig;
  c=srgb(c);
  vec3 dn=dither3(gl_FragCoord.xy,uGrainAmt*0.0+fract(uMisc.w*0.618034));
  c+=dn/255.0*1.2;
  c+=(dither3(gl_FragCoord.xy+91.0,uMisc.w)*uGrainAmt).x*vec3(1.0)*0.5/255.0*0.0;
  o=vec4(c,1.0);
}`;

class Post {
  constructor(g) {
    this.g = g; this.w = 0; this.h = 0;
    this.p = { down: g.fsProgram('bdown', SH.bloomDownFS), up: g.fsProgram('bup', SH.bloomUpFS), tm: g.fsProgram('tonemap', SH.tonemapFS) };
    this.bloomAmt = 0.035; this.sat = 1.0;
  }
  resize(w, h) {
    const g = this.g, gl = g.gl; this.w = w; this.h = h;
    this.levels = [];
    let lw = w >> 1, lh = h >> 1;
    for (let i = 0; i < 6; i++) {
      lw = Math.max(lw, 2); lh = Math.max(lh, 2);
      const t = g.tex2D(lw, lh, 'RGBA16F'); this.levels.push({ t, f: g.fbo([t]), w: lw, h: lh });
      lw >>= 1; lh >>= 1;
    }
  }
  run(hdrTex, outW, outH, ss, misc) {
    const g = this.g, gl = g.gl; const L = this.levels;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    let src = hdrTex, sw = this.w, sh = this.h;
    for (let i = 0; i < L.length; i++) {
      g.bind(L[i].f);
      this.p.down.use().t('uSrc', src).v2('uTexel', 1 / sw, 1 / sh).i('uFirst', i === 0 ? 1 : 0); g.fs();
      src = L[i].t; sw = L[i].w; sh = L[i].h;
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = L.length - 2; i >= 0; i--) {
      g.bind(L[i].f);
      this.p.up.use().t('uSrc', L[i + 1].t).v2('uTexel', 1 / L[i + 1].w, 1 / L[i + 1].h).f('uW', 1.0); g.fs();
    }
    gl.disable(gl.BLEND);
    g.bind(null, outW, outH);
    this.p.tm.use().t('uHdr', hdrTex).t('uBloom', L[0].t).f('uBloomAmt', this.bloomAmt).f('uSS', ss).v2('uTexel', 1 / this.w, 1 / this.h).f('uSat', this.sat).f('uGrainAmt', 1.0);
    g.fs();
  }
}
