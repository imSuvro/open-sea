'use strict';
// Shared GLSL chunks: global UBO, noise, atmosphere.
const GFIELDS = [
  ['mat4', 'uViewProj'], ['mat4', 'uInvViewProj'], ['mat4', 'uView'],
  ['vec4', 'uCam'],      // xyz camera world position (m), w time (s)
  ['vec4', 'uSunDir'],   // xyz toward sun, w sin(elevation)
  ['vec4', 'uSunCol'],   // rgb sun irradiance at sea level (pre-exposed), w exposure
  ['vec4', 'uMoonDir'],  // xyz toward moon
  ['vec4', 'uMoonCol'],  // rgb moon irradiance at sea level (pre-exposed), w phase
  ['vec4', 'uCSun'],     // rgb sun irradiance at cloud altitude
  ['vec4', 'uCMoon'],    // rgb moon irradiance at cloud altitude
  ['vec4', 'uWx'],       // x cloud cover, y rain, z storm darkness, w haze
  ['vec4', 'uWind'],     // xy wave travel direction, z wind speed m/s, w Beaufort
  ['vec4', 'uMisc'],     // x underwater(0/1), y lightning flash, z dt, w frame
  ['vec4', 'uRes'],      // w h 1/w 1/h
  ['vec4', 'uCloud'],    // x base m, y thickness m, z stratiform, w quality
  ['vec4', 'uDrift'],    // xy cloud drift m, z-w unused
  ['vec4', 'uNight'],    // rgb night-sky radiance, w star visibility
  ['vec4', 'uYacht'],    // xyz yacht position, w heading
  ['vec4', 'uFog'],      // x fog visibility (m), y aerial tint amount, zw unused
];
const GOFF = {}; let GSIZE = 0;
GFIELDS.forEach(([t, n]) => { GOFF[n] = GSIZE; GSIZE += t === 'mat4' ? 16 : 4; });
const GBUF = new Float32Array(GSIZE);
function gset(name, v) { GBUF.set(v, GOFF[name]); }

SH.global = 'layout(std140) uniform Globals {\n' + GFIELDS.map(([t, n]) => t + ' ' + n + ';').join('\n') + '\n};\n';
SH.fsVS = `
out vec2 vUV;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUV = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

SH.common = `
#include <global>
#define PI 3.14159265359
#define TAU 6.28318530718
float sat(float x){ return clamp(x,0.0,1.0); }
vec3 sat3(vec3 x){ return clamp(x,0.0,1.0); }
float sq(float x){ return x*x; }
float remap(float v,float a,float b,float c,float d){ return c+(v-a)/(b-a)*(d-c); }
float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
uint pcg(uint v){ uint s=v*747796405u+2891336453u; uint w=((s>>((s>>28u)+4u))^s)*277803737u; return (w>>22u)^w; }
uvec3 pcg3(uvec3 v){ v=v*1664525u+1013904223u; v.x+=v.y*v.z; v.y+=v.z*v.x; v.z+=v.x*v.y; v^=v>>16u; v.x+=v.y*v.z; v.y+=v.z*v.x; v.z+=v.x*v.y; return v; }
float h11(uint n){ return float(pcg(n))*(1.0/4294967295.0); }
float h21(ivec2 p){ return float(pcg3(uvec3(p.x,p.y,0)).x)*(1.0/4294967295.0); }
vec2  h22(ivec2 p){ uvec3 h=pcg3(uvec3(p.x,p.y,0)); return vec2(h.xy)*(1.0/4294967295.0); }
vec3  h33(ivec3 p){ return vec3(pcg3(uvec3(p)))*(1.0/4294967295.0); }
float h31(ivec3 p){ return float(pcg3(uvec3(p)).x)*(1.0/4294967295.0); }
// gradient noise with analytic derivative (returns value, d/dx, d/dy)
vec3 gnoiseD(vec2 x){
  ivec2 i=ivec2(floor(x)); vec2 f=fract(x);
  vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0), du=30.0*f*f*(f*(f-2.0)+1.0);
  vec2 ga=h22(i)*2.0-1.0, gb=h22(i+ivec2(1,0))*2.0-1.0, gc=h22(i+ivec2(0,1))*2.0-1.0, gd=h22(i+ivec2(1,1))*2.0-1.0;
  float va=dot(ga,f), vb=dot(gb,f-vec2(1,0)), vc=dot(gc,f-vec2(0,1)), vd=dot(gd,f-vec2(1,1));
  float k0=va, k1=vb-va, k2=vc-va, k4=va-vb-vc+vd;
  vec2 d=ga+u.x*(gb-ga)+u.y*(gc-ga)+u.x*u.y*(ga-gb-gc+gd)+du*(u.yx*(va-vb-vc+vd)+vec2(vb,vc)-va);
  return vec3(k0+k1*u.x+k2*u.y+k4*u.x*u.y, d);
}
float vnoise(vec2 x){
  ivec2 i=ivec2(floor(x)); vec2 f=fract(x); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+ivec2(1,0)),u.x), mix(h21(i+ivec2(0,1)),h21(i+ivec2(1,1)),u.x), u.y);
}
float fbm2(vec2 p, int oct){ float a=0.5,s=0.0; mat2 r=mat2(0.8,0.6,-0.6,0.8); for(int i=0;i<8;i++){ if(i>=oct)break; s+=a*vnoise(p); p=r*p*2.03+vec2(17.1,3.7); a*=0.5; } return s; }
vec2 sincos2(float a){ return vec2(sin(a),cos(a)); }
vec3 dither3(vec2 fc, float t){ // interleaved gradient noise, triangular
  float a=fract(52.9829189*fract(dot(fc+t*5.588238,vec2(0.06711056,0.00583715))));
  float b=fract(52.9829189*fract(dot(fc.yx+t*3.17,vec2(0.06711056,0.00583715))));
  return vec3(a+b-1.0);
}
float ign(vec2 fc, float t){ uvec3 h=pcg3(uvec3(uint(fc.x),uint(fc.y),uint(t*7.0)+17u)); return float(h.x)*(1.0/4294967295.0); }
`;

// ------------------------------------------------------------------ atmosphere (km units, planet-centred)
SH.atmo = `
#include <common>
const float Rg=6360.0, Rt=6420.0;
const vec3 bR=vec3(0.005802,0.013558,0.0331);
const float bMs=0.003996, bMe=0.00444;
const vec3 bO=vec3(0.000650,0.001881,0.000085);
uniform float uMieScale;
vec3 atmoExt(float h, float ms){ return bR*exp(-h/8.0)+bMe*ms*exp(-h/1.2)+bO*max(0.0,1.0-abs(h-25.0)/15.0); }
float raySphereFar(vec3 ro, vec3 rd, float R){ float b=dot(ro,rd), c=dot(ro,ro)-R*R, d=b*b-c; return d<0.0? -1.0 : -b+sqrt(d); }
float raySphereNear(vec3 ro, vec3 rd, float R){ float b=dot(ro,rd), c=dot(ro,ro)-R*R, d=b*b-c; return d<0.0? -1.0 : -b-sqrt(d); }
vec2 transUV(float r, float mu){
  float H=sqrt(Rt*Rt-Rg*Rg), rho=sqrt(max(r*r-Rg*Rg,0.0));
  float d=max(0.0,-r*mu+sqrt(max(r*r*(mu*mu-1.0)+Rt*Rt,0.0)));
  float dmin=Rt-r, dmax=rho+H;
  return vec2((d-dmin)/(dmax-dmin), rho/H);
}
#ifdef USE_TRANS
uniform sampler2D uTrans;
vec3 transLUT(float r, float mu){
  vec2 uv=transUV(r,mu); uv=clamp(uv,0.0,1.0);
  uv=(uv*vec2(255.0,63.0)+0.5)/vec2(256.0,64.0);
  return texture(uTrans,uv).rgb;
}
#endif
float phaseR(float c){ return 3.0/(16.0*PI)*(1.0+c*c); }
float phaseCS(float c, float g){ float k=3.0/(8.0*PI)*(1.0-g*g)/(2.0+g*g); return k*(1.0+c*c)/pow(1.0+g*g-2.0*g*c,1.5); }
`;

// transmittance LUT 256x64
SH.transFS = `
#include <atmo>
in vec2 vUV; out vec4 o;
void main(){
  float H=sqrt(Rt*Rt-Rg*Rg);
  float xmu=vUV.x*(256.0/255.0)-0.5/255.0, xr=vUV.y*(64.0/63.0)-0.5/63.0; xmu=clamp(xmu,0.0,1.0); xr=clamp(xr,0.0,1.0);
  float rho=xr*H, r=sqrt(rho*rho+Rg*Rg);
  float dmin=Rt-r, dmax=rho+H, d=dmin+xmu*(dmax-dmin);
  float mu=d<=0.0?1.0:clamp((H*H-rho*rho-d*d)/(2.0*r*d),-1.0,1.0);
  vec3 tau=vec3(0.0); const int N=48;
  for(int i=0;i<N;i++){
    float t=(float(i)+0.5)/float(N)*d;
    float rr=sqrt(r*r+t*t+2.0*r*mu*t);
    tau+=atmoExt(rr-Rg,1.0)*(d/float(N));
  }
  o=vec4(exp(-tau),1.0);
}`;

// sky-view LUT: rows = elevation (non-linear), cols = azimuth; sun + moon single/multi scatter
SH.skyViewFS = `
#define USE_TRANS
#include <atmo>
in vec2 vUV; out vec4 o;
uniform vec3 uL0, uL1;      // light dirs
uniform vec3 uE0, uE1;      // light irradiance (pre-exposed)
uniform float uAlt;         // camera altitude km
vec3 dirFromUV(vec2 uv){
  float az=uv.x*TAU;
  float v=uv.y*2.0-1.0; float el=sign(v)*v*v*PI*0.5;
  return vec3(sin(az)*cos(el), sin(el), cos(az)*cos(el));
}
vec3 scatterLight(vec3 ro, vec3 rd, float tMax, vec3 L, vec3 E){
  if(lum(E)<=0.0) return vec3(0.0);
  float mu=dot(rd,L);
  float pr=phaseR(mu), pm=phaseCS(mu,0.8);
  vec3 sum=vec3(0.0), thr=vec3(1.0);
  const int N=40;
  for(int i=0;i<N;i++){
    float s0=float(i)/float(N), s1=float(i+1)/float(N);
    float t0=tMax*s0*s0, t1=tMax*s1*s1, t=0.5*(t0+t1), ds=t1-t0;
    vec3 p=ro+rd*t; float r=length(p), h=r-Rg;
    float dR=exp(-h/8.0), dM=exp(-h/1.2)*uMieScale;
    vec3 ext=bR*dR+bMe*dM+bO*max(0.0,1.0-abs(h-25.0)/15.0);
    vec3 stepT=exp(-ext*ds);
    float sb=dot(p,L); float miss=sb<0.0?sqrt(max(dot(p,p)-sb*sb,0.0)):1.0e9;
    float shadow=smoothstep(Rg-15.0,Rg+55.0,miss);            // soft planet shadow (refraction + finite sun)
    vec3 Ts=transLUT(r,dot(p/r,L))*shadow;
    vec3 sc=Ts*((bR*dR)*pr+(bMs*dM)*pm + (bR*dR+bMs*dM)*(0.5/(4.0*PI)) );   // + cheap multiple-scattering term
    vec3 integ=(sc-sc*stepT)/max(ext,vec3(1e-7));
    sum+=thr*integ; thr*=stepT;
  }
  return sum*E;
}
void main(){
  vec3 rd=dirFromUV(vUV);
  vec3 ro=vec3(0.0,Rg+uAlt,0.0);
  float tTop=raySphereFar(ro,rd,Rt);
  float tG=raySphereNear(ro,rd,Rg);
  float tMax=tG>0.0?tG:tTop;
  vec3 c=scatterLight(ro,rd,tMax,uL0,uE0)+scatterLight(ro,rd,tMax,uL1,uE1);
  o=vec4(c,1.0);
}`;

// helper included by anything that wants sky colour at a direction from the sky-view LUT
SH.skyLookup = `
uniform sampler2D uSkyView;
vec3 skyView(vec3 rd){
  float az=atan(rd.x,rd.z); if(az<0.0) az+=TAU;
  float el=asin(clamp(rd.y,-1.0,1.0));
  float v=sign(el)*sqrt(abs(el)/(PI*0.5));
  vec2 uv=vec2(az/TAU, v*0.5+0.5);
  vec3 c=texture(uSkyView, uv).rgb;   // wrap handled by REPEAT on s
  return mix(c,vec3(lum(c)),0.75*uWx.z);
}
`;

// CPU-side transmittance for computing light colours
const ATM = {
  Rg: 6360, Rt: 6420,
  ext(h) {
    const R = [0.005802, 0.013558, 0.0331], dm = Math.exp(-h / 1.2) * 0.00444, dr = Math.exp(-h / 8), o = Math.max(0, 1 - Math.abs(h - 25) / 15);
    const O = [0.00065, 0.001881, 0.000085];
    return [R[0] * dr + dm + O[0] * o, R[1] * dr + dm + O[1] * o, R[2] * dr + dm + O[2] * o];
  },
  trans(hKm, mu) {
    const r = ATM.Rg + hKm, s2 = 1 - mu * mu;
    // planet blocked?
    if (mu < 0 && r * Math.sqrt(s2) < ATM.Rg) return [0, 0, 0];
    const d = -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + ATM.Rt * ATM.Rt));
    const N = 64; let tau = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N * d, rr = Math.sqrt(r * r + t * t + 2 * r * mu * t), e = ATM.ext(rr - ATM.Rg);
      tau[0] += e[0] * d / N; tau[1] += e[1] * d / N; tau[2] += e[2] * d / N;
    }
    return [Math.exp(-tau[0]), Math.exp(-tau[1]), Math.exp(-tau[2])];
  },
};
