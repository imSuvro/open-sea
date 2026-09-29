'use strict';
// Underwater: volumetric pass (spectral absorption, sun shafts from the real wave slopes), Snell's window lives in the water shader, plus fish.

SH.uwCommon = `
const vec3 UW_A=vec3(0.36,0.062,0.030);        // absorption per metre (R,G,B)
const vec3 UW_KD=vec3(0.30,0.068,0.038);       // diffuse attenuation of daylight
const float UW_B=0.028;                        // scattering per metre
float fresAir(float c){ float n=1.333; float s2=(1.0-c*c)/(n*n); float ct=sqrt(max(1.0-s2,0.0)); float rs=(c-n*ct)/(c+n*ct), rp=(n*c-ct)/(n*c+ct); return 0.5*(rs*rs+rp*rp); }
// ambient down-welling colour just under the surface (from the ambient cube: up-facing)
`;

SH.underFS = `
#include <common>
#include <cascades>
#include <uwCommon>
in vec2 vUV; layout(location=0) out vec4 o;
uniform sampler2D uScene, uDepth, uAmb; uniform samplerCube uEnv;
uniform float uWaterY;
vec2 slopeAt(vec2 x){
  return textureLod(uSlope1,x*uCasc.y,0.0).xy+textureLod(uSlope2,x*uCasc.z,0.0).xy*0.9+textureLod(uSlope3,x*uCasc.w,1.0).xy*0.35;
}
// light transmitted through the wavy surface to a point P (below water): returns focusing intensity
float shaftAt(vec3 P, vec3 Lair){
  vec3 tw=refract(-Lair,vec3(0,1,0),1.0/1.333);            // flat-water refracted direction (travel dir, downward)
  float t=P.y/tw.y; vec2 Q=P.xz-tw.xz*t;                    // where the flat ray would have crossed the surface
  for(int i=0;i<2;i++){
    vec2 s=slopeAt(Q); vec3 n=normalize(vec3(-s.x,1.0,-s.y));
    vec3 tq=refract(-Lair,n,1.0/1.333);
    vec2 land=Q+tq.xz*(P.y/tq.y);
    Q+=P.xz-land;
  }
  const float e=0.35;
  vec2 q0=Q, q1=Q+vec2(e,0.0), q2=Q+vec2(0.0,e);
  vec3 tq0=refract(-Lair,normalize(vec3(-slopeAt(q0).x,1.0,-slopeAt(q0).y)),1.0/1.333);
  vec3 tq1=refract(-Lair,normalize(vec3(-slopeAt(q1).x,1.0,-slopeAt(q1).y)),1.0/1.333);
  vec3 tq2=refract(-Lair,normalize(vec3(-slopeAt(q2).x,1.0,-slopeAt(q2).y)),1.0/1.333);
  vec2 l0=q0+tq0.xz*(P.y/tq0.y), l1=q1+tq1.xz*(P.y/tq1.y), l2=q2+tq2.xz*(P.y/tq2.y);
  vec2 a=(l1-l0)/e, b=(l2-l0)/e; float det=abs(a.x*b.y-a.y*b.x);
  return clamp(1.0/max(det,0.12),0.0,5.0);
}
void main(){
  vec2 uv=vUV; vec4 w=uInvViewProj*vec4(uv*2.0-1.0,1.0,1.0); vec3 rd=normalize(w.xyz/w.w-uCam.xyz);
  float d=texture(uDepth,uv).r; float dist=120.0;
  if(d<1.0){ vec4 pw=uInvViewProj*vec4(uv*2.0-1.0,d*2.0-1.0,1.0); dist=length(pw.xyz/pw.w-uCam.xyz); }
  vec3 scene=texture(uScene,uv).rgb;
  float tMax=min(dist,110.0);
  vec3 ro=uCam.xyz;
  // ambient light just below the surface
  vec3 ambUp=texelFetch(uAmb,ivec2(2,0),0).rgb;
  vec3 Esun=uSunCol.rgb; vec3 Emoon=uMoonCol.rgb;
  float sunUp=step(0.01,uSunDir.y), moonUp=step(0.01,uMoonDir.y);
  vec3 sunW=refract(-uSunDir.xyz,vec3(0,1,0),1.0/1.333), moonW=refract(-uMoonDir.xyz,vec3(0,1,0),1.0/1.333);
  float ft=1.0-fresAir(max(uSunDir.y,0.05)); float fm=1.0-fresAir(max(uMoonDir.y,0.05));
  vec3 Lacc=vec3(0.0), T=vec3(1.0);
  const int N=22;
  float jit=ign(gl_FragCoord.xy,uCam.w*60.0);
  vec3 cext=UW_A+UW_B;
  for(int i=0;i<N;i++){
    float s0=float(i)/float(N), s1=float(i+1)/float(N);
    float t0=tMax*s0*s0, t1=tMax*s1*s1; float t=mix(t0,t1,jit); float ds=t1-t0;
    vec3 P=ro+rd*t; float z=max(uWaterY-P.y,0.0);
    vec3 atten=exp(-UW_KD*z);
    vec3 amb=ambUp*atten*0.55;
    // in-scatter source: ambient (isotropic-ish) + sun shaft (forward peaked)
    float cg=dot(rd,sunW); float hg=(1.0-0.81)/(4.0*PI*pow(1.0+0.81-1.8*cg,1.5));
    float dirF=mix(0.10,1.9,smoothstep(-0.75,0.85,rd.y)); vec3 eqAmb=amb*vec3(0.08,0.40,0.62)*dirF;
    vec3 src=vec3(0.0);
    if(sunUp>0.0){
      float sh=shaftAt(vec3(P.x,P.y-uWaterY,P.z),uSunDir.xyz);
      vec3 sunAt=Esun*ft*exp(-UW_KD*z/max(-sunW.y,0.25));
      src+=sunAt*sh*0.075*(min(hg,6.0)*0.5+0.05);
    }
    if(moonUp>0.0){ float cgm=dot(rd,moonW); float hgm=(1.0-0.81)/(4.0*PI*pow(1.0+0.81-1.8*cgm,1.5)); float shm=shaftAt(vec3(P.x,P.y-uWaterY,P.z),uMoonDir.xyz); src+=Emoon*fm*exp(-UW_KD*z/max(-moonW.y,0.25))*shm*UW_B*(hgm*0.75+0.02); }
    vec3 stepT=exp(-cext*ds);
    vec3 integ=eqAmb*(1.0-stepT)+src*(1.0-stepT)/cext;
    Lacc+=T*integ; T*=stepT;
  }
  // beyond tMax (open water): equilibrium radiance
  vec3 col=scene*T+Lacc;
  if(uFog.y==5.0) col=vec3(T.g);
  if(uFog.y==6.0) col=Lacc*10.0;
  if(uFog.y==7.0) col=vec3(dist/120.0, d, isnan(Lacc.g)?1.0:0.0);
  if(uFog.y==8.0) col=scene;
  o=vec4(col,1.0e5);
}`;

// ---------------------------------------------------------------- fish
SH.fishVS = `
#include <common>
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 aInst;       // school, r1, r2, r3
uniform vec4 uSchool[6];                // x,y,z centre offset, w = fish length
uniform vec4 uSchoolB[6];               // spread radius, speed, depth amplitude, count-scale
uniform vec2 uAnchor;
out vec3 vP; out vec3 vN; out vec3 vLocal; out float vId; out float vSize;
vec3 centre(int s, float t){
  vec4 a=uSchool[s], b=uSchoolB[s];
  float w=b.y;
  vec3 c=vec3(a.x+9.0*sin(w*t*0.21+float(s)*1.7),a.y+b.z*sin(w*t*0.43+float(s)),a.z+9.0*cos(w*t*0.17+float(s)*2.3));
  return c;
}
void main(){
  int s=int(aInst.x+0.5); vec4 a=uSchool[s], b=uSchoolB[s];
  float t=uCam.w;
  vec3 c0=centre(s,t), c1=centre(s,t+0.25);
  // school centre, wrapped in a big lattice around the anchor so schools always exist near where you dive
  vec3 vel=(c1-c0)/0.25;
  vec2 rel=c0.xz; rel=mod(rel+400.0,800.0)-400.0;   // keep within +-400 m of the anchor
  vec3 C=vec3(uAnchor.x+rel.x,c0.y,uAnchor.y+rel.y);
  // per-fish offset inside the school (slow swirl)
  vec3 r=aInst.yzw;
  float ph=r.x*6.283+t*(0.12+0.10*r.y);
  vec3 off=vec3(sin(ph)*r.y, (r.z-0.5)*1.4, cos(ph*1.13+r.z*6.0)*r.x)*b.x*(0.5+0.5*r.z);
  vec3 fwd=normalize(vec3(vel.x+cos(ph)*0.16*r.y, vel.y*0.3, vel.z-sin(ph)*0.16*r.x)+1e-4);
  vec3 P0=C+off;
  vec3 up=vec3(0,1,0); vec3 rgt=normalize(cross(fwd,up)); vec3 upv=cross(rgt,fwd);
  float len=a.w*(0.8+0.4*r.z);
  vec3 lp=aPos*len;                       // aPos in -0.5..0.5 along x
  float wig=sin(t*(7.0+3.0*r.x)*b.y*2.0-aPos.x*6.0+r.y*20.0);
  lp.z+=wig*len*0.11*(0.15+pow(0.5-aPos.x,2.0)*3.2);
  vec3 wp=P0+fwd*lp.x+upv*lp.y+rgt*lp.z;
  vec3 nrm=normalize(fwd*aNrm.x+upv*aNrm.y+rgt*aNrm.z);
  vP=wp; vN=nrm; vLocal=aPos; vId=r.x; vSize=len;
  gl_Position=uViewProj*vec4(wp,1.0);
}`;
SH.fishFS = `
#include <common>
#include <uwCommon>
in vec3 vP; in vec3 vN; in vec3 vLocal; in float vId; in float vSize;
layout(location=0) out vec4 o;
uniform sampler2D uAmb; uniform float uWaterY; uniform vec3 uTint;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(uCam.xyz-vP);
  float z=max(uWaterY-vP.y,0.0);
  float back=smoothstep(0.05,0.55,N.y), belly=smoothstep(-0.05,-0.6,N.y);
  vec3 col=mix(vec3(0.80,0.84,0.88),vec3(0.05,0.12,0.16)*uTint,back);   // silver flanks, dark back
  col=mix(col,vec3(0.92,0.93,0.92),belly);
  col*=0.85+0.25*sin(vLocal.x*38.0+vId*9.0)*smoothstep(0.35,0.0,abs(N.y));   // scale shimmer
  // eye
  float eye=1.0-smoothstep(0.02,0.045,length(vec2(vLocal.x-0.36,abs(vLocal.z)*0.0+vLocal.y-0.02))); col=mix(col,vec3(0.01),eye*step(0.05,abs(N.z)));
  // light: sun through surface (caustic-ish flicker) + ambient
  vec3 ambUp=texelFetch(uAmb,ivec2(2,0),0).rgb;
  vec3 atten=exp(-UW_KD*z);
  float caus=0.55+0.9*pow(0.5+0.5*sin(vP.x*1.3+uCam.w*0.9+sin(vP.z*1.1+uCam.w*0.7)*2.0)*sin(vP.z*1.7-uCam.w*0.8+sin(vP.x*0.9)*1.5),3.0);
  vec3 sunAt=uSunCol.rgb*(1.0-fresAir(max(uSunDir.y,0.05)))*atten*max(dot(N,uSunDir.xyz)*0.5+0.5,0.0)*caus*step(0.01,uSunDir.y);
  vec3 E=sunAt/PI+ambUp*atten*0.6*(0.6+0.4*N.y);
  vec3 c=col*E*1.6;
  float spec=pow(max(dot(reflect(-V,N),normalize(vec3(0.0,1.0,0.0))),0.0),8.0)*0.35;
  c+=vec3(0.7,0.85,0.9)*spec*atten*ambUp*belly*0.0+ vec3(spec)*sunAt*0.04;
  float dist=length(uCam.xyz-vP);
  o=vec4(c,dist);
}`;

function buildFishMesh() {
  const V = [], I = [], rings = 14, sides = 10;
  const prof = x => { // x from 0 (tail) to 1 (nose) -> radius (height, width)
    const u = x; const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.8);
    return [0.085 * body * (u < 0.15 ? 0.55 + u * 3 : 1), 0.05 * body * (u < 0.15 ? 0.55 + u * 3 : 1)];
  };
  for (let i = 0; i <= rings; i++) {
    const x = i / rings, [rh, rw] = prof(x);
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2, y = Math.sin(a) * rh, z = Math.cos(a) * rw;
      const n = M.v3.norm([0.0, Math.sin(a) / Math.max(rh, 1e-3), Math.cos(a) / Math.max(rw, 1e-3)]);
      V.push(x - 0.5, y, z, n[0], n[1], n[2]);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides; I.push(a, c, b, b, c, d);
  }
  // tail fin (two triangles fan) + dorsal fin
  const base = V.length / 6;
  const tri = (p0, p1, p2, n) => { const i0 = V.length / 6; [p0, p1, p2].forEach(p => V.push(p[0], p[1], p[2], n[0], n[1], n[2])); I.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 1); };
  tri([-0.5, 0, 0], [-0.62, 0.11, 0], [-0.62, -0.11, 0], [0, 0, 1]);
  tri([-0.05, 0.075, 0], [-0.2, 0.15, 0], [-0.22, 0.07, 0], [0, 0, 1]);
  tri([-0.18, -0.06, 0], [-0.26, -0.11, 0], [-0.28, -0.05, 0], [0, 0, 1]);
  return { v: new Float32Array(V), i: new Uint16Array(I) };
}

class Under {
  constructor(g, opts) {
    this.g = g; const gl = g.gl;
    this.prog = g.fsProgram('under', SH.underFS);
    this.fishProg = g.program('fish', SH.fishVS, SH.fishFS);
    this.enabled = opts.fish;
    // fish mesh + instances
    const m = buildFishMesh(); this.nIdx = m.i.length;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.i, gl.STATIC_DRAW);
    // schools: [len, count]
    this.schools = [
      { pos: [0, -9, 0], len: 0.16, n: 420, spread: 6.0, speed: 1.0, depth: 3.0 },
      { pos: [10, -11, -5], len: 0.34, n: 110, spread: 7.0, speed: 0.8, depth: 4.0 },
      { pos: [-9, -13, 8], len: 0.85, n: 14, spread: 9.0, speed: 0.55, depth: 4.0 },
      { pos: [6, -6.5, -9], len: 0.22, n: 260, spread: 5.0, speed: 1.2, depth: 2.5 },
      { pos: [-14, -17, -6], len: 1.9, n: 3, spread: 14.0, speed: 0.4, depth: 6.0 },
      { pos: [4, -9, 12], len: 0.5, n: 30, spread: 8.0, speed: 0.7, depth: 3.0 },
    ];
    const inst = [];
    this.schools.forEach((s, si) => { for (let k = 0; k < s.n; k++) inst.push(si, Math.random(), Math.random(), Math.random()); });
    this.nInst = inst.length / 4;
    const ibuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ibuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(2, 1);
    this.sA = new Float32Array(this.schools.flatMap(s => [s.pos[0], s.pos[1], s.pos[2], s.len]));
    this.sB = new Float32Array(this.schools.flatMap(s => [s.spread, s.speed, s.depth, 1]));
    this.anchor = [0, 0];
    this.w = 0; this.h = 0;
  }
  resize(w, h) {
    const g = this.g, gl = g.gl; this.w = w; this.h = h;
    if (this.copy) gl.deleteTexture(this.copy.tex);
    this.copy = g.tex2D(w, h, 'RGBA16F'); this.copyFbo = g.fbo([this.copy]);
    this.colorFbo = null;
  }
  drawFish(sky) {
    if (!this.enabled) return;
    const g = this.g, gl = g.gl, p = this.fishProg.use();
    p.t('uAmb', sky.amb).f('uWaterY', 0).v3('uTint', 1.0, 1.0, 1.0).v2('uAnchor', this.anchor[0], this.anchor[1]);
    gl.uniform4fv(p.L('uSchool'), this.sA); gl.uniform4fv(p.L('uSchoolB'), this.sB);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_SHORT, 0, this.nInst);
  }
  // fullscreen volumetric pass, applied on top of the geometry pass
  draw(hdr, sky, waves, cam) {
    const g = this.g, gl = g.gl;
    if (!this.copy || this.w !== hdr.w) this.resize(hdr.w, hdr.h);
    if (!hdr.colorOnly) hdr.colorOnly = g.fbo([hdr.color]);
    // copy scene colour
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.fbo.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copyFbo.fb);
    gl.blitFramebuffer(0, 0, hdr.w, hdr.h, 0, 0, hdr.w, hdr.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    g.bind(hdr.colorOnly);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
    const p = this.prog.use(); waves.bindCascades(p);
    p.t('uScene', this.copy).t('uDepth', hdr.depth).t('uAmb', sky.amb).t('uEnv', sky.env).f('uWaterY', 0);
    g.fs(); gl.depthMask(true);
  }
}
