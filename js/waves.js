'use strict';
// GPU FFT ocean (Tessendorf) with 4 cascades, JONSWAP + swell, choppy displacement, jacobian foam.
const BEAUFORT = [ // [wind m/s, target Hs m]
  [0.2, 0.02], [1.0, 0.09], [2.6, 0.24], [4.4, 0.55], [6.7, 0.95], [9.4, 1.7], [12.3, 2.8], [15.5, 4.0], [19.0, 5.6], [22.6, 7.3], [26.5, 9.2], [30.5, 11.2], [34.0, 13.0]];
function beaufort(b) {
  b = M.clamp(b, 0, 12); const i = Math.min(11, Math.floor(b)), f = b - i;
  return [M.mix(BEAUFORT[i][0], BEAUFORT[i + 1][0], f), M.mix(BEAUFORT[i][1], BEAUFORT[i + 1][1], f)];
}
const G0 = 9.81;
function jonswapShape(w, wp, alpha, gamma) {
  const sigma = w <= wp ? 0.07 : 0.09, r = Math.exp(-((w - wp) ** 2) / (2 * (sigma * wp) ** 2));
  return alpha * G0 * G0 / w ** 5 * Math.exp(-1.25 * (wp / w) ** 4) * gamma ** r;
}
function seaParams(bf) {
  const [U, Hs] = beaufort(bf);
  const F = Math.min(1.4e5, 2.2e4 * U * U / G0);
  const wp = Math.min(10.5, Math.max(0.3, 22 * Math.cbrt(G0 * G0 / (Math.max(U, 0.3) * Math.max(F, 300)))));   // keep the spectral peak inside the resolved band at very low winds
  const alpha = 0.076 * Math.pow(U * U / (Math.max(F, 300) * G0), 0.22);
  const wpc = Math.min(wp, 10.5);                    // keep the peak inside the resolved band at very low winds
  const gamma = M.mix(1.0, 3.3, M.smooth(1.5, 8, U));
  // numeric m0 of the shape, to normalise to the target significant wave height
  let m0 = 0; const w0 = 0.08, w1 = 90, n = 6000;
  for (let i = 0; i < n; i++) { const w = w0 * Math.pow(w1 / w0, (i + 0.5) / n), dw = w * Math.log(w1 / w0) / n; m0 += jonswapShape(w, wp, alpha, gamma) * dw; }
  const target = (Hs / 4) ** 2;
  const swellHs = 0.10 + 0.05 * Math.min(bf, 10) + (bf < 1.5 ? 0.14 : 0);
  return { U, Hs, wp, alpha, gamma, amp: Math.sqrt(target / m0), swellHs: Math.min(swellHs, 1.6), swellW: 0.52 + 0.05 * Math.sin(bf) };
}

SH.wavesCommon = `
const float G=9.81; const float KM=370.0;
float dispersion(float k){ return sqrt(G*k*(1.0+k*k/(KM*KM))); }
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
`;

SH.h0FS = `
#include <common>
#include <wavesCommon>
in vec2 vUV; out vec4 o;
uniform int uN; uniform float uL; uniform vec2 uBand;
uniform float uU, uWp, uAlpha, uGamma, uAmp, uWindAng, uSwellHs, uSwellW, uSwellAng, uSmax;
vec2 gauss(ivec2 m){
  uvec3 h=pcg3(uvec3(m.x+4096,m.y+4096,17));
  float u1=max(float(h.x)/4294967295.0,1e-6), u2=float(h.y)/4294967295.0;
  float r=sqrt(-2.0*log(u1)); return r*vec2(cos(TAU*u2),sin(TAU*u2));
}
float jonswap(float w){
  float sigma=w<=uWp?0.07:0.09; float r=exp(-sq(w-uWp)/(2.0*sq(sigma*uWp)));
  return uAlpha*G*G/pow(w,5.0)*exp(-1.25*pow(uWp/w,4.0))*pow(uGamma,r);
}
float dirSpread(float th, float s){ // Longuet-Higgins cos^2s(theta/2), normalised
  float c=max(cos(0.5*th),0.0); float n=sqrt(s+0.25)/(2.0*sqrt(PI)); return n*pow(c,2.0*s);
}
vec2 h0(ivec2 m){
  vec2 k=TAU*vec2(m)/uL; float kl=length(k);
  if(kl<uBand.x||kl>=uBand.y||kl<1e-5) return vec2(0.0);
  float w=dispersion(kl);
  float dwdk=G*(1.0+3.0*kl*kl/(KM*KM))/(2.0*w);
  float th=atan(k.y,k.x)-uWindAng; th=atan(sin(th),cos(th));
  float wr=w/uWp;
  float s = wr<1.0 ? 6.97*pow(wr,4.06) : 9.77*pow(wr,-2.33-1.45*(uU*uWp/G-1.17));
  s=clamp(s,mix(3.5,0.6,smoothstep(1.0,5.0,uU)),uSmax);
  float S = jonswap(w)*uAmp*uAmp*dirSpread(th,s);
  // swell: narrow band, narrow direction
  float ths=atan(k.y,k.x)-uSwellAng; ths=atan(sin(ths),cos(ths));
  float sig=0.07; float A=sq(uSwellHs/4.0)/(sig*2.5066283);
  S += A*exp(-sq(w-uSwellW)/(2.0*sig*sig))*dirSpread(ths,50.0);
  float psi=S*dwdk/kl;                 // spectrum density per unit k-space area
  float dk=TAU/uL;
  return gauss(m)*sqrt(psi)*dk*0.5;
}
void main(){
  ivec2 id=ivec2(gl_FragCoord.xy);
  ivec2 m=ivec2(id.x<uN/2?id.x:id.x-uN, id.y<uN/2?id.y:id.y-uN);
  vec2 a=h0(m); vec2 b=h0(-m);
  o=vec4(a, b.x, -b.y);   // h0(k), conj(h0(-k))
}`;

SH.specFS = `
#include <common>
#include <wavesCommon>
in vec2 vUV;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
uniform sampler2D uH0; uniform int uN; uniform float uL, uT;
uniform float uW0;
vec2 mi(vec2 a){ return vec2(-a.y,a.x); }
void main(){
  ivec2 id=ivec2(gl_FragCoord.xy);
  ivec2 m=ivec2(id.x<uN/2?id.x:id.x-uN, id.y<uN/2?id.y:id.y-uN);
  vec2 k=TAU*vec2(m)/uL; float kl=length(k);
  if(kl<1e-5){ o0=vec4(0); o1=vec4(0); return; }
  vec4 h0=texelFetch(uH0,id,0);
  float w=dispersion(kl); w=floor(w/uW0+0.5)*uW0;   // loopable time period
  float c=cos(w*uT), s=sin(w*uT);
  vec2 h=cmul(h0.xy,vec2(c,s))+cmul(h0.zw,vec2(c,-s));
  vec2 ih=mi(h); vec2 kn=k/kl;
  vec2 Dx=kn.x*ih, Dz=kn.y*ih, Sx=k.x*ih, Sz=k.y*ih;
  vec2 Dxx=-kn.x*k.x*h, Dzz=-kn.y*k.y*h, Dxz=-kn.x*k.y*h;
  o0=vec4(h+mi(Dx), Dz+mi(Sx));
  o1=vec4(Sz+mi(Dxx), Dzz+mi(Dxz));
}`;

SH.fftFS = `
#include <common>
#include <wavesCommon>
in vec2 vUV;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
uniform sampler2D uIn0, uIn1; uniform int uNs, uVert, uN;
void main(){
  ivec2 id=ivec2(gl_FragCoord.xy);
  int j=uVert==0?id.x:id.y;
  int Ns=uNs; int k=j&(Ns-1); int blk=j/(2*Ns); int i=blk*Ns+k;
  bool up=(j-blk*2*Ns)>=Ns;
  ivec2 ia=uVert==0?ivec2(i,id.y):ivec2(id.x,i);
  ivec2 ib=uVert==0?ivec2(i+uN/2,id.y):ivec2(id.x,i+uN/2);
  float ang=TAU*float(k)/float(2*Ns); vec2 tw=vec2(cos(ang),sin(ang));
  vec4 a0=texelFetch(uIn0,ia,0), b0=texelFetch(uIn0,ib,0), a1=texelFetch(uIn1,ia,0), b1=texelFetch(uIn1,ib,0);
  vec4 v0=vec4(cmul(b0.xy,tw),cmul(b0.zw,tw)), v1=vec4(cmul(b1.xy,tw),cmul(b1.zw,tw));
  o0=up?a0-v0:a0+v0; o1=up?a1-v1:a1+v1;
}`;

SH.asmFS = `
#include <common>
in vec2 vUV;
layout(location=0) out vec4 oDisp; layout(location=1) out vec4 oSlope; layout(location=2) out vec4 oMom;
uniform sampler2D uR0, uR1; uniform float uChop;
void main(){
  ivec2 id=ivec2(gl_FragCoord.xy);
  vec4 a=texelFetch(uR0,id,0), b=texelFetch(uR1,id,0);
  float h=a.x, Dx=a.y, Dz=a.z, Sx=a.w, Sz=b.x, Dxx=b.y, Dzz=b.z, Dxz=b.w;
  oDisp=vec4(uChop*Dx,h,uChop*Dz,0.0);
  oSlope=vec4(Sx,Sz,uChop*Dxx,uChop*Dzz);
  oMom=vec4(Sx*Sx,Sz*Sz,Sx*Sz,uChop*Dxz);
}`;

// shared sampler bundle for the four cascades
SH.cascades = `
uniform sampler2D uDisp0,uDisp1,uDisp2,uDisp3, uSlope0,uSlope1,uSlope2,uSlope3, uMom0,uMom1,uMom2,uMom3;
uniform vec4 uCasc;      // 1/L for each cascade
uniform vec4 uCascL;     // L
`;

// foam window: accumulate persistent foam where the summed jacobian folds
SH.foamFS = `
#include <common>
#include <cascades>
in vec2 vUV; out vec4 o;
uniform sampler2D uPrev; uniform vec2 uOrigin, uPrevOrigin; uniform float uExtent, uDt;
uniform float uKappa, uThr, uWidth, uDecay, uGate;
void main(){
  vec2 p=uOrigin+vUV*uExtent;                       // world x0 of this texel
  float texel=uExtent/1024.0;
  vec4 s0=vec4(0.0);
  // lod so each foam texel integrates the finer cascades
  float l1=log2(texel*uCasc.y*256.0), l2=log2(texel*uCasc.z*256.0), l3=log2(texel*uCasc.w*256.0);
  vec4 sl0=textureLod(uSlope0,p*uCasc.x,0.0), sl1=textureLod(uSlope1,p*uCasc.y,max(l1,0.0)), sl2=textureLod(uSlope2,p*uCasc.z,max(l2,0.0)), sl3=textureLod(uSlope3,p*uCasc.w,max(l3,0.0));
  vec4 mo0=textureLod(uMom0,p*uCasc.x,0.0), mo1=textureLod(uMom1,p*uCasc.y,max(l1,0.0)), mo2=textureLod(uMom2,p*uCasc.z,max(l2,0.0)), mo3=textureLod(uMom3,p*uCasc.w,max(l3,0.0));
  float Dxx=sl0.z+sl1.z+0.55*sl2.z, Dzz=sl0.w+sl1.w+0.55*sl2.w, Dxz=mo0.w+mo1.w+0.55*mo2.w;
  float J=(1.0+uKappa*Dxx)*(1.0+uKappa*Dzz)-sq(uKappa*Dxz);
  float src=smoothstep(uThr+uWidth,uThr-uWidth,J)*uGate;
  vec2 puv=(p-uPrevOrigin)/uExtent;
  vec4 prev=vec4(0.0);
  if(all(greaterThan(puv,vec2(0.0)))&&all(lessThan(puv,vec2(1.0)))){
    vec2 px=puv*1024.0; ivec2 c=ivec2(px);
    // tiny 3x3 diffusion so foam edges soften over time
    vec4 sum=vec4(0.0); float wsum=0.0;
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ float w=(x==0&&y==0)?1.0:0.06; sum+=w*texelFetch(uPrev,clamp(c+ivec2(x,y),ivec2(0),ivec2(1023)),0); wsum+=w; }
    prev=sum/wsum;
  }
  float f=max(prev.x*exp(-uDt*uDecay), src);
  float fresh=max(prev.y*exp(-uDt*uDecay*4.0), src);
  o=vec4(f,fresh,0.0,1.0);
}`;

// probe pass: CPU height/normal queries. Positions in uniform array; output row of texels.
SH.probeFS = `
#include <common>
#include <cascades>
in vec2 vUV; out vec4 o;
uniform vec2 uP[16];
void main(){
  int i=int(gl_FragCoord.x);
  vec2 p=uP[i]; vec2 x0=p;
  for(int it=0;it<4;it++){
    vec3 d=textureLod(uDisp0,x0*uCasc.x,0.0).xyz+textureLod(uDisp1,x0*uCasc.y,0.0).xyz+textureLod(uDisp2,x0*uCasc.z,0.0).xyz+textureLod(uDisp3,x0*uCasc.w,0.0).xyz;
    x0=p-d.xz;
  }
  float h=textureLod(uDisp0,x0*uCasc.x,0.0).y+textureLod(uDisp1,x0*uCasc.y,0.0).y+textureLod(uDisp2,x0*uCasc.z,0.0).y+textureLod(uDisp3,x0*uCasc.w,0.0).y;
  vec2 s=textureLod(uSlope0,x0*uCasc.x,0.0).xy+textureLod(uSlope1,x0*uCasc.y,0.0).xy+textureLod(uSlope2,x0*uCasc.z,0.0).xy+textureLod(uSlope3,x0*uCasc.w,0.0).xy;
  o=vec4(h,s.x,s.y,1.0);
}`;

class Waves {
  constructor(g, N = 256) {
    this.g = g; const gl = g.gl; this.N = N;
    this.L = [1500, 380, 95, 24];
    this.band = [[0, 0.35], [0.35, 1.4], [1.4, 5.6], [5.6, 33.0]];
    this.chop = 1.0;
    this.p = {
      h0: g.fsProgram('h0', SH.h0FS), spec: g.fsProgram('spec', SH.specFS), fft: g.fsProgram('fft', SH.fftFS),
      asm: g.fsProgram('asm', SH.asmFS), foam: g.fsProgram('foam', SH.foamFS), probe: g.fsProgram('probe', SH.probeFS),
    };
    const T = (i, o = {}) => g.tex2D(N, N, i, Object.assign({ filter: 'nearest', wrap: 'repeat' }, o));
    this.h0 = this.L.map(() => T('RGBA32F'));
    this.h0Fbo = this.h0.map(t => g.fbo([t]));
    this.A = [T('RGBA32F'), T('RGBA32F')]; this.B = [T('RGBA32F'), T('RGBA32F')];
    this.fboA = g.fbo(this.A); this.fboB = g.fbo(this.B);
    this.disp = []; this.slope = []; this.mom = []; this.outFbo = [];
    for (let c = 0; c < 4; c++) {
      const o = { filter: 'linear', wrap: 'repeat', mips: true, aniso: true };
      const d = g.tex2D(N, N, 'RGBA16F', o), s = g.tex2D(N, N, 'RGBA16F', o), m = g.tex2D(N, N, 'RGBA16F', o);
      this.disp.push(d); this.slope.push(s); this.mom.push(m); this.outFbo.push(g.fbo([d, s, m]));
    }
    // foam window (world anchored, ping-pong)
    this.FW = 1024; this.foamExtent = 400;
    this.foam = [0, 1].map(() => g.tex2D(this.FW, this.FW, 'RGBA16F', { filter: 'linear', wrap: 'clamp' }));
    this.foamFbo = this.foam.map(t => g.fbo([t]));
    this.foamCur = 0; this.foamOrigin = [0, 0]; this.foamPrevOrigin = [1e9, 1e9];
    this.foamFar = [0, 1].map(() => g.tex2D(this.FW, this.FW, 'RGBA16F', { filter: 'linear', wrap: 'clamp' }));
    this.foamFarFbo = this.foamFar.map(t => g.fbo([t]));
    this.farCur = 0; this.farOrigin = [0, 0]; this.farPrevOrigin = [1e9, 1e9]; this.farExtent = 2400; this.farAcc = 0; this.farTick = 0;
    // probes
    this.probeTex = g.tex2D(16, 1, 'RGBA32F', { filter: 'nearest' }); this.probeFbo = g.fbo([this.probeTex]);
    this.probePBO = [gl.createBuffer(), gl.createBuffer()];
    this.probePBO.forEach(b => { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, 16 * 16, gl.STREAM_READ); });
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.probeSync = [null, null]; this.probeIdx = 0;
    this.probeResult = new Float32Array(64); this.probeCount = 0;
    this.sea = -1; this.par = null; this.time = 0;
    this.windAng = 0.55; this.swellAng = 0.55 + 0.45; this.farBias = 0.10;
  }
  setSea(bf) {
    if (Math.abs(bf - this.sea) < 1e-4) return;
    this.sea = bf; const P = this.par = seaParams(bf); this.U = P.U;
    const g = this.g, gl = g.gl;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    for (let c = 0; c < 4; c++) {
      g.bind(this.h0Fbo[c]);
      this.p.h0.use().i('uN', this.N).f('uL', this.L[c]).v2('uBand', this.band[c][0], this.band[c][1])
        .f('uU', P.U).f('uWp', P.wp).f('uAlpha', P.alpha).f('uGamma', P.gamma).f('uAmp', P.amp).f('uWindAng', this.windAng)
        .f('uSwellHs', P.swellHs).f('uSwellW', P.swellW).f('uSwellAng', this.swellAng).f('uSmax', M.mix(7.0, 60, M.smooth(1, 7, P.U)));
      g.fs();
    }
  }
  windDir() { return [Math.cos(this.windAng), Math.sin(this.windAng)]; }
  update(t) {
    const g = this.g, gl = g.gl, N = this.N;
    this.time = t; this.chop = M.mix(1.0, 1.5, M.smooth(4, 24, this.U || 5));
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const Tloop = 320, w0 = TAU_ / Tloop, tt = t % Tloop;
    for (let c = 0; c < 4; c++) {
      g.bind(this.fboA);
      this.p.spec.use().t('uH0', this.h0[c]).i('uN', N).f('uL', this.L[c]).f('uT', tt).f('uW0', w0);
      g.fs();
      let src = 0; // 0: A holds data, 1: B
      const passes = Math.log2(N);
      for (let dir = 0; dir < 2; dir++) for (let s = 0; s < passes; s++) {
        const from = src === 0 ? this.A : this.B, to = src === 0 ? this.fboB : this.fboA;
        g.bind(to);
        this.p.fft.use().t('uIn0', from[0]).t('uIn1', from[1]).i('uNs', 1 << s).i('uVert', dir).i('uN', N);
        g.fs(); src ^= 1;
      }
      const res = src === 0 ? this.A : this.B;
      g.bind(this.outFbo[c]);
      this.p.asm.use().t('uR0', res[0]).t('uR1', res[1]).f('uChop', this.chop);
      g.fs();
      g.genMips(this.disp[c]); g.genMips(this.slope[c]); g.genMips(this.mom[c]);
    }
  }
  bindCascades(p) {
    p.t('uDisp0', this.disp[0]).t('uDisp1', this.disp[1]).t('uDisp2', this.disp[2]).t('uDisp3', this.disp[3])
      .t('uSlope0', this.slope[0]).t('uSlope1', this.slope[1]).t('uSlope2', this.slope[2]).t('uSlope3', this.slope[3])
      .t('uMom0', this.mom[0]).t('uMom1', this.mom[1]).t('uMom2', this.mom[2]).t('uMom3', this.mom[3])
      .v4('uCasc', 1 / this.L[0], 1 / this.L[1], 1 / this.L[2], 1 / this.L[3]).v4('uCascL', this.L[0], this.L[1], this.L[2], this.L[3]);
    return p;
  }
  updateFoam(dt, camXZ) {
    const g = this.g, gl = g.gl, U = this.U || 5;
    const texel = this.foamExtent / this.FW;
    const ox = Math.floor((camXZ[0] - this.foamExtent / 2) / texel) * texel, oz = Math.floor((camXZ[1] - this.foamExtent / 2) / texel) * texel;
    this.foamPrevOrigin = this.foamOrigin.slice(); this.foamOrigin = [ox, oz];
    const nxt = this.foamCur ^ 1;
    g.bind(this.foamFbo[nxt]);
    const gate = M.smooth(2.0, 4.0, U), kappa = 2.0;
    const p = this.p.foam.use(); this.bindCascades(p);
    p.t('uPrev', this.foam[this.foamCur]).v2('uOrigin', ox, oz).v2('uPrevOrigin', this.foamPrevOrigin[0], this.foamPrevOrigin[1])
      .f('uExtent', this.foamExtent).f('uDt', Math.min(dt, 0.1)).f('uKappa', kappa).f('uThr', this.foamThr ?? foamThrFor(this.sea)).f('uWidth', 0.22).f('uDecay', 0.22 - 0.06 * M.smooth(6, 22, U)).f('uGate', gate);
    g.fs(); this.foamCur = nxt;
  }
  updateFoamFar(dt, camXZ) {
    this.farAcc += Math.min(dt, 0.1); this.farTick++;
    if (this.farTick % 2 && this.farOrigin[0] !== 0) return;
    const g = this.g, U = this.U || 5, texel = this.farExtent / this.FW;
    const ox = Math.floor((camXZ[0] - this.farExtent / 2) / texel) * texel, oz = Math.floor((camXZ[1] - this.farExtent / 2) / texel) * texel;
    this.farPrevOrigin = this.farOrigin.slice(); this.farOrigin = [ox, oz];
    const nxt = this.farCur ^ 1; g.bind(this.foamFarFbo[nxt]);
    const gate = M.smooth(2.0, 4.0, U), kappa = 2.0;
    const p = this.p.foam.use(); this.bindCascades(p);
    p.t('uPrev', this.foamFar[this.farCur]).v2('uOrigin', ox, oz).v2('uPrevOrigin', this.farPrevOrigin[0], this.farPrevOrigin[1])
      .f('uExtent', this.farExtent).f('uDt', Math.min(this.farAcc, 0.2)).f('uKappa', kappa).f('uThr', (this.foamThr ?? foamThrFor(this.sea)) + this.farBias).f('uWidth', 0.22).f('uDecay', 0.22 - 0.06 * M.smooth(6, 22, U)).f('uGate', gate);
    g.fs(); this.farCur = nxt; this.farAcc = 0;
  }
  // --- probes (async readback, ~2 frames latency)
  probe(points) { // points: array of [x,z]
    const g = this.g, gl = g.gl, n = Math.min(16, points.length);
    // read back previous
    const rd = this.probeIdx ^ 1;
    if (this.probeSync[rd]) {
      const st = gl.clientWaitSync(this.probeSync[rd], 0, 0);
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.probePBO[rd]); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.probeResult, 0, 64);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteSync(this.probeSync[rd]); this.probeSync[rd] = null; this.probeValid = true;
      }
    }
    g.bind(this.probeFbo);
    const p = this.p.probe.use(); this.bindCascades(p);
    const arr = new Float32Array(32); for (let i = 0; i < n; i++) { arr[2 * i] = points[i][0]; arr[2 * i + 1] = points[i][1]; }
    gl.uniform2fv(p.L('uP'), arr);
    g.fs();
    const cur = this.probeIdx;
    if (!this.probeSync[cur]) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.probePBO[cur]); gl.readPixels(0, 0, 16, 1, gl.RGBA, gl.FLOAT, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.probeSync[cur] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
      this.probeIdx ^= 1;
    }
  }
  probeBlocking(points) {   // stills: issue, wait, read back immediately
    const g = this.g, gl = g.gl, n = Math.min(16, points.length);
    g.bind(this.probeFbo); const p = this.p.probe.use(); this.bindCascades(p);
    const arr = new Float32Array(32); for (let i = 0; i < n; i++) { arr[2 * i] = points[i][0]; arr[2 * i + 1] = points[i][1]; }
    gl.uniform2fv(p.L('uP'), arr); g.fs(); gl.readPixels(0, 0, 16, 1, gl.RGBA, gl.FLOAT, this.probeResult); this.probeValid = true;
  }
  height(i) { return this.probeResult[4 * i]; }
  slopeAt(i) { return [this.probeResult[4 * i + 1], this.probeResult[4 * i + 2]]; }
}
const TAU_ = Math.PI * 2;
// J-threshold table (calibrated against target whitecap coverage per sea state, see tools/calib.js)
const FOAM_TABLE = [[0, 0.2], [2.5, 0.42], [3, 0.517], [4, 0.517], [5, 0.56], [6, 0.45], [7, 0.31], [8, 0.17], [9, 0.02], [10, -0.06], [11, -0.13], [12, -0.20]];
function foamThrFor(sea) {
  const T = FOAM_TABLE; if (sea <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (sea <= T[i][0]) { const f = (sea - T[i - 1][0]) / (T[i][0] - T[i - 1][0]); return M.mix(T[i - 1][1], T[i][1], f); }
  return T[T.length - 1][1];
}
