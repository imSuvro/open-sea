'use strict';
// Procedural cruising sloop: lofted hull, deck, cabin, keel, mast, dynamic sails, rigging lines. Local frame: +X bow, +Y up, +Z starboard.

// ---------------------------------------------------------------- geometry builder
class MeshBuilder {
  constructor() { this.v = []; this.i = []; }
  get count() { return this.v.length / 9; }
  // fn(u,v) -> [x,y,z, uvx, uvy]; outwardRef(u,v)->[x,y,z] or null; orient by reference direction
  grid(nu, nv, fn, mat, ref, flip) {
    const P = [], base = this.count;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P.push(fn(i / nu, j / nv));
    const at = (i, j) => P[Math.min(nv, Math.max(0, j)) * (nu + 1) + Math.min(nu, Math.max(0, i))];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const p = at(i, j), du = M.v3.sub(at(i + 1, j), at(i - 1, j)), dv = M.v3.sub(at(i, j + 1), at(i, j - 1));
      let n = M.v3.cross(du, dv); const l = M.v3.len(n);
      if (l < 1e-9) { n = ref ? M.v3.norm(ref(i / nu, j / nv, p)) : [0, 1, 0]; } else n = M.v3.mul(n, 1 / l);
      if (ref) { const r = ref(i / nu, j / nv, p); if (M.v3.dot(n, r) < 0) n = M.v3.mul(n, -1); }
      else if (flip) n = M.v3.mul(n, -1);
      this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], p[3] || 0, p[4] || 0, mat);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      this.i.push(a, b, c, b, d, c);
    }
  }
  tube(pts, r0, r1, sides, mat) {   // pts: [[x,y,z],[x,y,z]] straight or polyline
    const seg = pts.length - 1;
    for (let s = 0; s < seg; s++) {
      const a = pts[s], b = pts[s + 1], d = M.v3.norm(M.v3.sub(b, a));
      let t = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]; const u = M.v3.norm(M.v3.cross(d, t)), w = M.v3.cross(d, u);
      const ra = M.mix(r0, r1, s / seg), rb = M.mix(r0, r1, (s + 1) / seg);
      this.grid(sides, 1, (uu, vv) => { const th = uu * TAU_, c = Math.cos(th), sn = Math.sin(th), p = vv ? b : a, r = vv ? rb : ra;
        return [p[0] + (u[0] * c + w[0] * sn) * r, p[1] + (u[1] * c + w[1] * sn) * r, p[2] + (u[2] * c + w[2] * sn) * r, uu, vv * M.v3.len(M.v3.sub(b, a))]; },
        mat, (uu, vv, p) => { const th = uu * TAU_, c = Math.cos(th), sn = Math.sin(th); return [u[0] * c + w[0] * sn, u[1] * c + w[1] * sn, u[2] * c + w[2] * sn]; });
    }
  }
}
const smoothstepJ = (a, b, x) => M.smooth(a, b, x);

const HULL = {
  L: 13.0, x0: -6.2,
  sheerY(u) { return 0.90 + 0.60 * Math.pow(smoothstepJ(0.50, 1.0, u), 1.6) + 0.07 * (1 - u) * (1 - u); },
  keelY(u) { return M.mix(-0.28, -0.56, Math.pow(Math.sin(Math.PI * Math.pow(Math.min(u, 1), 0.85)), 0.6)) + 1.05 * Math.pow(smoothstepJ(0.72, 1.0, u), 1.5); },
  beam(u) { return 2.05 * Math.pow(Math.max(1 - Math.pow(u, 2.7), 0), 0.60) * (0.80 + 0.20 * u * (1 - u) * 4); },
  xAt(u, v) { return HULL.x0 + HULL.L * u + 0.55 * v * v * smoothstepJ(0.86, 1.0, u); },
  // hull surface point on starboard side; v 0 keel -> 1 sheer
  pt(u, v, side = 1) {
    const b = HULL.beam(u), yb = HULL.keelY(u), ys = HULL.sheerY(u);
    const z = b * Math.pow(Math.max(1 - Math.pow(1 - v, 2.5), 0), 1 / 2.5) * (1 + 0.04 * v);   // slight flare
    return [HULL.xAt(u, v), yb + v * (ys - yb), side * z];
  },
  deckY(x, z) { const u = M.clamp((x - HULL.x0) / HULL.L, 0, 1), b = HULL.beam(u) + 1e-3; return HULL.sheerY(u) + 0.035 + 0.11 * (1 - Math.min(1, (z / b) ** 2)); },
};

function buildYachtMesh() {
  const B = new MeshBuilder();
  const NU = 70, NV = 22;
  // hull (both sides)
  for (const side of [1, -1]) {
    B.grid(NU, NV, (u, v) => { const p = HULL.pt(u, v, side); return [p[0], p[1], p[2], u * HULL.L, v]; }, 0,
      (u, v, p) => [0.02, (p[1] - (HULL.keelY(u) + HULL.sheerY(u)) * 0.5 + 0.35) * 0.25, p[2]]);
  }
  // transom
  B.grid(8, NV, (u, v) => {
    const q = HULL.pt(0, v, 1), zz = (u * 2 - 1) * q[2];
    return [q[0] - 0.12 * v, q[1], zz, u, v];
  }, 0, () => [-1, 0, 0]);
  // deck
  B.grid(NU, 10, (u, w) => {
    const ww = w * 2 - 1, b = HULL.beam(u), x = HULL.xAt(u, 1), z = ww * b * 0.985;
    return [x, HULL.deckY(x, z), z, x, z];
  }, 1, () => [0, 1, 0]);
  // coach roof
  const cx0 = -2.35, cx1 = 2.55;
  B.grid(40, 16, (u, th) => {
    const x = cx0 + u * (cx1 - cx0), t = th * Math.PI;
    const hw = 1.20 - 0.30 * u, hgt = 0.80 * (1 - Math.pow(smoothstepJ(0.55, 1.0, u), 1.5));
    const z = -Math.cos(t) * hw, y0 = HULL.deckY(x, z) - 0.02;
    const top = 0.80 * (1 - Math.pow(smoothstepJ(0.60, 1.0, u), 1.3));
    return [x, y0 + Math.pow(Math.sin(t), 0.55) * top + 0.0, z, x, t];
  }, 3, (u, th, p) => [0.0, 1.0, p[2] * 1.2]);
  // companionway hatch + foredeck hatch (small boxes)
  const box = (x0, x1, y0, y1, z0, z1, mat) => {
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const faces = [[0, 1, 2, 3, [0, -1, 0]], [4, 7, 6, 5, [0, 1, 0]], [0, 4, 5, 1, [0, 0, -1]], [3, 2, 6, 7, [0, 0, 1]], [0, 3, 7, 4, [-1, 0, 0]], [1, 5, 6, 2, [1, 0, 0]]];
    for (const f of faces) B.grid(1, 1, (u, v) => { const a = c[f[0]], b = c[f[1]], d = c[f[3]]; return [a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v, a[2] + (b[2] - a[2]) * u + (d[2] - a[2]) * v, u, v]; }, mat, () => f[4]);
  };
  box(3.6, 4.5, HULL.deckY(4.0, 0) - 0.02, HULL.deckY(4.0, 0) + 0.10, -0.42, 0.42, 3);
  box(-3.0, -2.35, HULL.deckY(-2.7, 0), HULL.deckY(-2.7, 0) + 0.62, -0.45, 0.45, 3);
  // cockpit coamings (low walls) and wheel pedestal
  for (const s of [1, -1]) B.grid(20, 3, (u, v) => { const x = -5.5 + u * 3.0, z = s * (1.55 - 0.15 * u), y = HULL.deckY(x, z); return [x, y + v * 0.34 - 0.02, z + s * 0.001 * v, x, v]; }, 2, () => [0, 0, s]);
  B.tube([[-4.6, HULL.deckY(-4.6, 0), 0], [-4.6, HULL.deckY(-4.6, 0) + 0.95, 0]], 0.09, 0.07, 10, 8);
  // mast, boom, spreaders
  const mx = 1.55, dY = HULL.deckY(mx, 0), mastH = 17.2;
  B.tube([[mx, dY, 0], [mx, dY + mastH, 0]], 0.11, 0.05, 14, 4);
  const boomY = dY + 1.45;
  B.tube([[mx - 0.05, boomY, 0], [mx - 4.85, boomY + 0.05, 0]], 0.065, 0.055, 10, 4);
  for (const hh of [5.4, 10.4]) for (const s of [1, -1]) B.tube([[mx, dY + hh, 0], [mx - 0.05, dY + hh, s * (hh < 8 ? 1.1 : 0.75)]], 0.028, 0.022, 6, 4);
  // keel, bulb, rudder
  const fin = (xr, cr, xt, ct, y0, y1, th, mat) => {
    B.grid(14, 10, (u, v) => { const y = M.mix(y0, y1, v), c = M.mix(cr, ct, v), xle = M.mix(xr, xt, v); const a = u * 2 - 1; const side = a < 0 ? -1 : 1; const s = Math.abs(a);
      const t = th * M.mix(1, 0.55, v) * 5 * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1015 * s ** 4);
      return [xle - c * s, y, side * t, s, v]; }, mat, (u, v, p) => [0, 0, u < 0.5 ? -1 : 1]);
  };
  fin(1.5, 2.6, 0.9, 1.2, HULL.keelY(0.5) + 0.05, -2.05, 0.14, 7);
  fin(-4.35, 0.95, -4.75, 0.7, -0.12, -1.95, 0.075, 7);
  B.grid(20, 12, (u, v) => { const a = u * 2 - 1, ph = v * TAU_; const r = 0.27 * Math.sqrt(Math.max(1 - a * a, 0)); return [1.2 + a * 1.35, -2.18 + r * Math.cos(ph) * 1.0, r * Math.sin(ph), u, v]; }, 7,
    (u, v, p) => [(p[0] - 1.2) * 0.1, p[1] + 2.18, p[2]]);
  // stanchions + bow pulpit / pushpit poles
  const stan = [];
  for (const s of [1, -1]) for (let x = -5.6; x <= 5.4; x += 1.3) { const u = (x - HULL.x0) / HULL.L, z = s * HULL.beam(u) * 0.94, y = HULL.deckY(x, z); B.tube([[x, y, z], [x, y + 0.62, z]], 0.012, 0.011, 5, 8); }
  B.tube([[-6.15, HULL.deckY(-6.1, 0.9) , 0.9], [-6.15, HULL.deckY(-6.1, 0.9) + 0.62, 0.9]], 0.014, 0.013, 6, 8);
  return B;
}

// rigging lines in local space (pairs of endpoints)
function staticRigging() {
  const mx = 1.55, dY = HULL.deckY(mx, 0), top = dY + 17.1, L = [];
  const add = (a, b, w = 0.016) => L.push([...a, w, ...b, w]);
  const bowTip = [HULL.xAt(1, 1) - 0.05, HULL.deckY(6.7, 0) + 0.15, 0];
  add(bowTip, [mx + 0.03, top, 0], 0.014);                        // forestay
  add([-6.05, HULL.deckY(-6.05, 0) + 0.3, 0], [mx - 0.03, top, 0], 0.014);   // backstay
  for (const s of [1, -1]) {
    const cp = [mx + 0.1, HULL.deckY(mx, s * 1.95) + 0.05, s * 1.95], sp1 = [mx, dY + 5.4, s * 1.1], sp2 = [mx - 0.05, dY + 10.4, s * 0.75];
    add(cp, sp1); add(sp1, sp2); add(sp2, [mx, top - 0.2, 0]);
    add([mx - 0.1, HULL.deckY(mx - 0.3, s * 1.9) + 0.05, s * 1.9], [mx, dY + 5.4, s * 0.12], 0.012);   // lower shrouds
    add([mx - 0.05, dY + 10.4, s * 0.75], [mx, dY + 5.4, s * 0.04], 0.010);
  }
  // lifelines
  for (const h of [0.32, 0.62]) for (const s of [1, -1]) {
    let prev = null;
    for (let x = -5.6; x <= 5.4; x += 1.3) { const u = (x - HULL.x0) / HULL.L, z = s * HULL.beam(u) * 0.94, p = [x, HULL.deckY(x, z) + h, z]; if (prev) add(prev, p, 0.008); prev = p; }
  }
  return L;
}

// ---------------------------------------------------------------- shaders
SH.yachtVS = `
#include <common>
#include <cloud>
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUV; layout(location=3) in float aMat;
uniform mat4 uModel; uniform mat4 uLightVP;
out vec3 vP; out vec3 vN; out vec2 vUV; out float vMat; out vec3 vLoc; out vec3 vLN; out vec2 vSh; out vec4 vLS;
void main(){
  vec4 wp=uModel*vec4(aPos,1.0); vP=wp.xyz; vN=mat3(uModel)*aNrm; vLN=aNrm; vUV=aUV; vMat=aMat; vLoc=aPos;
  vec2 hd=wp.xz-uCam.xz; wp.y-=dot(hd,hd)/(2.0*6.371e6);
  vSh=vec2(cloudShadowAt(uYacht.xyz+vec3(0.0,3.0,0.0),uSunDir.xyz),cloudShadowAt(uYacht.xyz+vec3(0.0,3.0,0.0),uMoonDir.xyz));
  vLS=uLightVP*vec4(vP,1.0);
  gl_Position=uViewProj*wp;
}`;
SH.yachtShadowVS = `
layout(location=0) in vec3 aPos;
uniform mat4 uModel; uniform mat4 uLightVP;
void main(){ gl_Position=uLightVP*(uModel*vec4(aPos,1.0)); }`;
SH.yachtShadowFS = `void main(){}`;
SH.yachtFS = `
#include <common>
#include <atmo>
#include <skyLookup>
in vec3 vP; in vec3 vN; in vec2 vUV; in float vMat; in vec3 vLoc; in vec3 vLN; in vec2 vSh; in vec4 vLS;
layout(location=0) out vec4 o;
uniform samplerCube uEnv; uniform sampler2D uAmb; uniform sampler2D uShadow;
uniform float uUnderY;      // water surface y at the yacht (for hull antifoul wetness)
vec3 ambCube(vec3 n){
  vec3 nn=n*n; vec3 c=vec3(0.0);
  c+=nn.x*texelFetch(uAmb,ivec2(n.x>0.0?0:1,0),0).rgb; c+=nn.y*texelFetch(uAmb,ivec2(n.y>0.0?2:3,0),0).rgb; c+=nn.z*texelFetch(uAmb,ivec2(n.z>0.0?4:5,0),0).rgb;
  return c;
}
float fresnelS(float c,float f0){ return f0+(1.0-f0)*pow(1.0-c,5.0); }
float ggx(float NH,float a){ float a2=a*a; float d=NH*NH*(a2-1.0)+1.0; return a2/(PI*d*d); }
float shadowPCF(vec4 ls,float bias){
  vec3 p=ls.xyz/ls.w*0.5+0.5;
  if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0) return 1.0;
  float s=0.0; vec2 ts=vec2(1.0/2048.0);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) s+=step(p.z-bias,texture(uShadow,p.xy+vec2(x,y)*ts).r);
  return s/9.0;
}
void main(){
  int m=int(vMat+0.5);
  vec3 V=normalize(uCam.xyz-vP);
  vec3 N=normalize(vN); if(m==5||m==6){ if(dot(N,V)<0.0) N=-N; } else if(!gl_FrontFacing) N=-N;
  vec3 alb=vec3(0.8); float rough=0.4, metal=0.0, trans=0.0, f0=0.04, glass=0.0;
  vec3 ln=vLN;
  if(m==0){        // hull
    alb=vec3(0.90,0.91,0.92)*(0.80+0.20*smoothstep(0.0,0.9,vLoc.y)); rough=0.16;
    float y=vLoc.y; float sheer=HULL_SHEER(vLoc.x);
    if(y<0.03){ alb=vec3(0.020,0.035,0.075); rough=0.5; }
    float boot=smoothstep(0.03,0.05,y)*(1.0-smoothstep(0.13,0.15,y)); alb=mix(alb,vec3(0.035,0.06,0.13),boot);
    float cove=smoothstep(sheer-0.34,sheer-0.32,y)*(1.0-smoothstep(sheer-0.25,sheer-0.23,y)); alb=mix(alb,vec3(0.07,0.10,0.16),cove);
    // ports
    float px=abs(vLoc.z)>0.6?1.0:0.0;
    vec2 q=vec2(vLoc.x+0.4,vLoc.y-(sheer*0.5+0.12));
    float pw=0.0; if(px>0.5&&ln.y<0.5){ float d=max(abs(q.x)-2.6*0.5*(1.0+0.0)-0.0,0.0); vec2 e=abs(vec2(mod(vLoc.x+3.4,1.55)-0.775,y-(sheer*0.5+0.18)))-vec2(0.52,0.11); float sd=length(max(e,0.0))+min(max(e.x,e.y),0.0)-0.05; pw=1.0-smoothstep(0.0,0.02,sd); pw*=step(-3.6,vLoc.x)*step(vLoc.x,2.8);}
    alb=mix(alb,vec3(0.006,0.008,0.012),pw); rough=mix(rough,0.06,pw); glass=pw;
  } else if(m==1){ alb=vec3(0.72,0.72,0.68); rough=0.75; float n=fract(sin(dot(floor(vUV*80.0),vec2(12.9,78.2)))*43758.5); alb*=0.93+0.07*n;
    if(vLoc.x<-2.4&&vLoc.x>-5.6&&abs(vLoc.z)<1.35){ float pl=smoothstep(0.0,0.02,abs(fract(vLoc.z/0.055)-0.5)-0.44+0.02); alb=mix(vec3(0.09,0.05,0.025),vec3(0.42,0.26,0.13),pl*(0.85+0.15*fract(sin(floor(vLoc.z/0.055)*91.7)*437.0))); rough=0.6; }
  } else if(m==2){ float pl=smoothstep(0.0,0.02,abs(fract(vUV.x*0.0+vLoc.z*9.0+vLoc.x*0.0)-0.5)-0.44+0.02); alb=mix(vec3(0.08,0.045,0.02),vec3(0.45,0.28,0.14),1.0); rough=0.55; }
  else if(m==3){    // cabin: white with dark window band
    alb=vec3(0.92,0.92,0.90); rough=0.22;
    float t=vUV.y/PI; float win=smoothstep(0.09,0.12,t)*(1.0-smoothstep(0.36,0.39,t))*step(-1.95,vLoc.x)*step(vLoc.x,2.2)*smoothstep(0.0,0.06,fract((vLoc.x+2.0)/1.05)*1.0+0.02)*(1.0-smoothstep(0.90,0.99,fract((vLoc.x+2.0)/1.05)));
    float sideM=step(0.4,abs(ln.z)); win*=sideM; float fw=step(2.05,vLoc.x)*step(0.5,ln.y+0.0)*0.0;
    alb=mix(alb,vec3(0.005,0.007,0.010),win); rough=mix(rough,0.05,win); glass=win;
    if(vLoc.y<0.0) alb=vec3(0.7);
  } else if(m==4){ alb=vec3(0.78,0.80,0.83); rough=0.32; metal=1.0; }
  else if(m==5||m==6){
    alb=m==5?vec3(0.94,0.92,0.87):vec3(0.96,0.95,0.91); rough=0.85; trans=0.62;
    float sy=vUV.y*(m==5?7.0:6.0); float seam=1.0-smoothstep(0.0,0.045,abs(fract(sy)-0.5)*2.0-0.90)*1.0; seam=smoothstep(0.93,1.0,abs(fract(sy)-0.5)*2.0)*0.22;
    float wr=sin(vUV.x*23.0+vUV.y*3.0)*sin(vUV.y*17.0+vUV.x*5.0);
    N=normalize(N+ (vec3(wr,0.0,-wr)*0.06)*(0.6+0.4*sin(vUV.y*40.0)));
    alb*=1.0-seam; float tape=smoothstep(0.93,0.95,vUV.x)*0.16; alb*=1.0-tape;
    if(m==5){ float bt=smoothstep(0.035,0.0,abs(fract(vUV.y*2.4*3.0+0.10)-0.5)-0.47)*smoothstep(0.55,0.62,vUV.x); alb*=1.0-0.55*bt*step(0.05,vUV.y); }
    if(m==6){ float uv2=smoothstep(0.88,0.91,vUV.x)*(1.0-smoothstep(0.985,1.0,vUV.x)); alb=mix(alb,vec3(0.10,0.22,0.48),0.85*uv2*step(0.18,vUV.y)); }
    alb*=0.93+0.07*sin(vUV.x*9.0+vUV.y*2.0);
    if(m==6){ float uvb=smoothstep(0.86,0.9,vUV.x)*smoothstep(0.30,0.34,vUV.y)*0.0; }
  }
  else if(m==7){ alb=vec3(0.02,0.03,0.05); rough=0.45; }
  else if(m==8){ alb=vec3(0.82); metal=1.0; rough=0.25; }
  vec3 Ls=uSunDir.xyz, Lm=uMoonDir.xyz;
  float sh=(m==5||m==6)?1.0:shadowPCF(vLS,0.0012);
  vec3 sunE=uSunCol.rgb*vSh.x*sh, moonE=uMoonCol.rgb*vSh.y*sh;
  float NL=dot(N,Ls), NLm=dot(N,Lm);
  float dS=trans>0.0? max(NL,0.0)+trans*max(-NL,0.0) : max(NL,0.0);
  float dM=trans>0.0? max(NLm,0.0)+trans*max(-NLm,0.0) : max(NLm,0.0);
  vec3 amb=ambCube(N);
  if(trans>0.0) amb=amb*0.6+ambCube(-N)*0.4*trans;
  vec3 diff=alb*(1.0-metal)*(sunE*dS/PI+moonE*dM/PI+amb);
  // specular: sun/moon GGX + env reflection
  float NV=max(dot(N,V),0.001); vec3 R=reflect(-V,N); float a=max(rough*rough,0.02);
  vec3 F0=mix(vec3(f0),alb,metal); vec3 spec=vec3(0.0);
  vec3 H=normalize(Ls+V); float NH=max(dot(N,H),0.0);
  float Fh=fresnelS(max(dot(H,V),0.0),f0);
  spec+=sunE*ggx(NH,a)*Fh*max(NL,0.0)/(4.0*max(NL,0.05)*NV+1e-3)*0.5*(trans>0.0?0.0:1.0);
  H=normalize(Lm+V); NH=max(dot(N,H),0.0);
  spec+=moonE*ggx(NH,a)*fresnelS(max(dot(H,V),0.0),f0)*0.5/(4.0*NV+1e-3)*(trans>0.0?0.0:1.0);
  vec3 Rf=R; if(Rf.y<0.0){ Rf.y=-Rf.y*0.3; }
  vec3 envc=textureLod(uEnv,Rf,clamp(rough*7.5,0.0,8.0)).rgb;
  float below=smoothstep(0.0,-0.3,R.y);
  envc=mix(envc,vec3(0.02,0.05,0.07)*(0.2+lum(amb)*2.0),below);
  vec3 Fe=F0+(max(vec3(1.0-rough),F0)-F0)*pow(1.0-NV,5.0);
  if(trans>0.0) Fe*=0.0;
  vec3 col=diff+spec+envc*Fe*(1.0-0.5*rough);
  if(glass>0.5) col=envc*fresnelS(NV,0.04)*3.0+diff*0.3;
  float dist=length(uCam.xyz-vP);
  if(uMisc.x>0.5){ float z=max(-vP.y,0.0); col*=exp(-vec3(0.30,0.068,0.038)*z); o=vec4(min(col,vec3(60000.0)),dist); return; }
  float T=exp(-dist/uFog.x);
  vec3 hd=normalize(vec3(-V.x,0.0,-V.z)+vec3(0.0,0.0,1e-5));
  vec3 fogc=skyView(normalize(vec3(hd.x,0.004+0.02*uWx.y,hd.z)))*mix(1.0,0.75,uWx.z);
  col=col*T+fogc*(1.0-T);
  o=vec4(min(col,vec3(60000.0)),dist);
}`.replace('HULL_SHEER(vLoc.x)', 'sheerYs(vLoc.x)');

SH.yachtFSPre = `
float sheerYs(float x){ float u=clamp((x+6.2)/13.0,0.0,1.0); float s=smoothstep(0.5,1.0,u); return 0.90+0.60*pow(s,1.6)+0.07*(1.0-u)*(1.0-u); }
`;

SH.lineVS = `
#include <common>
layout(location=0) in vec4 aA; layout(location=1) in vec4 aB;   // xyz + width
uniform mat4 uModel;
out float vAlpha; out vec3 vP;
void main(){
  int id=gl_VertexID; float end=float(id&1), side=float((id>>1)&1)*2.0-1.0;
  vec4 pa=uModel*vec4(aA.xyz,1.0), pb=uModel*vec4(aB.xyz,1.0);
  vec4 ca=uViewProj*pa, cb=uViewProj*pb;
  if(ca.w<0.01&&cb.w<0.01){ gl_Position=vec4(2.0,2.0,2.0,1.0); vAlpha=0.0; vP=pa.xyz; return; }
  vec2 sa=ca.xy/ca.w*uRes.xy*0.5, sb=cb.xy/cb.w*uRes.xy*0.5;
  vec2 d=normalize(sb-sa+1e-6); vec2 nrm=vec2(-d.y,d.x);
  vec4 c=end<0.5?ca:cb; float w=end<0.5?aA.w:aB.w;
  float pxw=w*uRes.y*0.5*uFog.z/c.w;
  float px=max(pxw,0.85);
  vAlpha=min(1.0,pxw/0.85)*0.9;
  vec2 off=nrm*side*px*uRes.zw*c.w;
  gl_Position=vec4(c.xy+off,c.z,c.w); vP=(end<0.5?pa:pb).xyz;
}`;
SH.lineFS = `
#include <common>
#include <skyLookup>
in float vAlpha; in vec3 vP; layout(location=0) out vec4 o;
void main(){
  vec3 up=vec3(0.0,1.0,0.0); vec3 col=vec3(0.65,0.66,0.68)*(uSunCol.rgb*0.16+uMoonCol.rgb*0.10+skyView(up)*0.5);
  float dist=length(uCam.xyz-vP); float T=exp(-dist/uFog.x);
  vec3 V=normalize(uCam.xyz-vP); vec3 fogc=skyView(normalize(vec3(-V.x,0.02,-V.z)))*mix(1.0,0.75,uWx.z);
  col=col*T+fogc*(1.0-T);
  o=vec4(col*vAlpha,vAlpha);
}`;

// ---------------------------------------------------------------- Yacht class
class Yacht {
  constructor(g) {
    this.g = g; const gl = g.gl;
    SH.yachtFS = SH.yachtFSPre + SH.yachtFS.replace(/HULL_SHEER\(vLoc\.x\)/g, 'sheerYs(vLoc.x)');
    this.prog = g.program('yacht', SH.yachtVS, SH.yachtFS);
    this.shadowProg = g.program('yachtShadow', SH.yachtShadowVS, SH.yachtShadowFS);
    this.lineProg = g.program('lines', SH.lineVS, SH.lineFS);
    const mb = buildYachtMesh();
    this.static = { v: new Float32Array(mb.v), i: new Uint32Array(mb.i) };
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.static.v, gl.STATIC_DRAW);
    const setAttr = () => { for (const [i, n, o] of [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 1, 32]]) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 36, o); } };
    setAttr();
    this.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.static.i, gl.STATIC_DRAW);
    this.nStatic = this.static.i.length;
    // sails (dynamic)
    this.SN = 26; this.ST = 16;
    this.sailVerts = new Float32Array(2 * (this.SN + 1) * (this.ST + 1) * 9);
    const nv = (this.SN + 1) * (this.ST + 1), idx = [];
    for (let k = 0; k < 2; k++) for (let j = 0; j < this.SN; j++) for (let i = 0; i < this.ST; i++) { const a = k * nv + j * (this.ST + 1) + i, b = a + 1, c = a + this.ST + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    this.sailIdx = new Uint32Array(idx);
    this.sailVao = gl.createVertexArray(); gl.bindVertexArray(this.sailVao);
    this.sailVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.sailVbo); gl.bufferData(gl.ARRAY_BUFFER, this.sailVerts.byteLength, gl.DYNAMIC_DRAW);
    setAttr();
    this.sailIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sailIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.sailIdx, gl.STATIC_DRAW);
    // lines
    this.lines = staticRigging(); this.lineVao = gl.createVertexArray(); gl.bindVertexArray(this.lineVao);
    this.lineBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf); gl.bufferData(gl.ARRAY_BUFFER, 8 * 4 * 200, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1);
    this.lineIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 2, 1, 1, 2, 3]), gl.STATIC_DRAW);
    // shadow map
    this.SM = 2048; this.shadowTex = g.depthTex(this.SM, this.SM);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    this.shadowFbo = g.fbo([], this.shadowTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo.fb); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    this.shadowFbo.w = this.SM; this.shadowFbo.h = this.SM;
    // state
    this.pos = [0, 0]; this.heading = 0; this.speed = 1.5; this.dist = 0;
    this.heave = 0; this.pitch = 0; this.roll = 0; this.yawRate = 0;
    this.sailMain = 0.5; this.sailJib = 0.5; this.side = 1; this.flutter = 0;
    this.model = M.ident(); this.lightVP = M.ident();
    this.probeLocal = [[5.3, 0], [-5.0, 0], [0, -1.7], [0, 1.7], [0.3, 0]];
    this.awaDeg = 60; this.twa = 90;
    this.track = { R: 120, Ls: 380, cx: 30, cz: 240 };
    this.s = 0;
    this.footprint = [0, 0, 0, 0];
    this.updateSails(0, 0);
    this.uploadLines();
  }
  // stadium track: returns position + heading for arc length s
  trackAt(s) {
    const T = this.track, R = T.R, Ls = T.Ls, per = 2 * Ls + 2 * Math.PI * R;
    s = ((s % per) + per) % per;
    // coordinates: legs run along local x' axis; rotate by track angle (legs perpendicular to wind)
    let x, z, hd;
    if (s < Ls) { x = -Ls / 2 + s; z = -R; hd = 0; }
    else if (s < Ls + Math.PI * R) { const a = (s - Ls) / R; x = Ls / 2 + R * Math.sin(a); z = -R * Math.cos(a); hd = a; }
    else if (s < 2 * Ls + Math.PI * R) { x = Ls / 2 - (s - Ls - Math.PI * R); z = R; hd = Math.PI; }
    else { const a = (s - 2 * Ls - Math.PI * R) / R; x = -Ls / 2 - R * Math.sin(a); z = R * Math.cos(a); hd = Math.PI + a; }
    return { x, z, hd };
  }
  worldTrack(s, wind) {   // rotate so that legs are perpendicular to the wind direction
    const t = this.trackAt(s), rot = Math.atan2(wind[1], wind[0]) + Math.PI / 2;   // local x' -> across the wind
    const c = Math.cos(rot), sn = Math.sin(rot);
    return { x: this.track.cx + t.x * c - t.z * sn, z: this.track.cz + t.x * sn + t.z * c, hd: t.hd + rot };
  }
  update(dt, wind, U, waves, seaState) {
    // sailing speed from a crude polar
    const p0 = this.worldTrack(this.s, wind);
    const windTo = Math.atan2(wind[1], wind[0]);
    // heading in world angle (atan2(z,x)); wind travelling towards windTo; true wind angle: angle between boat heading and wind FROM direction
    const windFrom = windTo + Math.PI;
    let twa = Math.atan2(Math.sin(p0.hd - windFrom), Math.cos(p0.hd - windFrom));   // -pi..pi, 0 = heading into the wind
    const at = Math.abs(twa);
    const hullLim = 6.3;
    const g = M.clamp(Math.sin(Math.min(at, 2.6) * 1.05) * 1.05 + 0.10 * M.smooth(0.35, 0.7, at), 0.0, 1.0) * M.smooth(0.42, 0.75, at);
    const target = hullLim * Math.tanh(0.62 * U * (0.15 + g) / hullLim * (U > 22 ? 0.75 : 1)) * (U < 0.6 ? U / 0.6 : 1);
    const tgt = Math.max(target, 0.05 + 0.15 * M.smooth(0, 1.5, U));
    this.speed += (tgt - this.speed) * (1 - Math.exp(-dt / 3.0));
    this.s += this.speed * dt;
    const p1 = this.worldTrack(this.s, wind);
    // low-pass the heading
    const dx = p1.x - this.pos[0], dz = p1.z - this.pos[1];
    if (this.first !== true) { this.first = true; this.pos = [p1.x, p1.z]; this.heading = p1.hd; }
    this.pos = [p1.x, p1.z];
    let dh = Math.atan2(Math.sin(p1.hd - this.heading), Math.cos(p1.hd - this.heading));
    this.heading += dh * (1 - Math.exp(-dt / 0.25));
    // apparent wind in boat frame
    const wvx = -Math.cos(windTo) * U * 1.0, wvz = -Math.sin(windTo) * U * 1.0;   // wind velocity vector (towards windTo): use +
    const wx = Math.cos(windTo) * U - Math.cos(this.heading) * this.speed, wz = Math.sin(windTo) * U - Math.sin(this.heading) * this.speed;
    // apparent wind direction (where it comes from) relative to bow, signed: + = from starboard
    const awFrom = Math.atan2(-wz, -wx);
    let awa = Math.atan2(Math.sin(awFrom - this.heading), Math.cos(awFrom - this.heading));
    // in our frame +Z local is starboard; local z axis in world = (sin?) handle: heading angle h: forward=(cos h, sin h); starboard = (-sin h, cos h)?? -> right-handed y-up, x fwd => +z local is world (−sin h?, ...)
    this.awaSigned = awa; this.awaDeg = Math.abs(awa) * 180 / Math.PI;
    const targetSide = awa > 0 ? -1 : 1;   // boom goes to the leeward side
    const absA = Math.abs(awa);
    const mainTarget = M.clamp(absA * 0.52, 0.05, 1.45), jibTarget = M.clamp(absA * 0.5 - 0.02, 0.06, 1.35);
    const luff = 1 - M.smooth(0.30, 0.62, absA);
    // signed sail angle with rate limit so tacks/gybes swing smoothly
    const tm = targetSide * mainTarget * (U < 0.8 ? 0.8 : 1), tj = targetSide * jibTarget;
    const rate = 1.1 * dt;
    this.sailMain += M.clamp(tm - this.sailMain, -rate, rate); this.sailJib += M.clamp(tj - this.sailJib, -rate * 1.2, rate * 1.2);
    this.flutter += ((U < 1.0 ? 0.35 : 0) + luff * 0.9 - this.flutter) * (1 - Math.exp(-dt / 0.4));
    this.flutter = M.clamp(this.flutter, 0, 1);
    // heel
    const heelWind = M.clamp(0.020 * U * U * (0.35 + 0.65 * Math.sin(Math.min(absA, 2.2))) / 3.0, 0, 0.52) * (U > 20 ? 0.9 : 1);
    const heelTarget = -targetSide * heelWind * (1 - luff * 0.7) * -1;
    this.heelRoll = (this.heelRoll || 0) + (heelTarget * -1 - (this.heelRoll || 0)) * (1 - Math.exp(-dt / 1.6));
    // buoyancy from probes
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const sampleH = i => waves.probeValid ? waves.height(i) : 0;
    const hb = sampleH(0), hs = sampleH(1), hp = sampleH(2), hst = sampleH(3), hc = sampleH(4);
    const heaveT = (hc * 0.4 + (hb + hs) * 0.5 * 0.35 + (hp + hst) * 0.5 * 0.25) - 0.02;
    const pitchT = Math.atan2(hb - hs, 10.3) * 0.85;
    const rollT = Math.atan2(hst - hp, 3.4) * 0.8;
    const k = 1 - Math.exp(-dt / 0.28);
    this.heave += (heaveT - this.heave) * k; this.pitch += (pitchT - this.pitch) * (1 - Math.exp(-dt / 0.4)); this.rollWave = (this.rollWave || 0) + (rollT - (this.rollWave || 0)) * (1 - Math.exp(-dt / 0.4));
    this.roll = this.rollWave + this.heelRoll;
    // model matrix: local +X forward -> world heading; local +Z (starboard) -> world (−sin h?, ...)
    // world forward f=(cos h,0,sin h); starboard (right of forward, y up) = f × up = (−sin h*... ) compute: right = cross(f,up)
    const f = [c, 0, s], up = [0, 1, 0]; const rgt = M.v3.cross(f, up);   // (0*0-s*1, s*0-c*0, c*1-0*0) = (-s,0,c)
    // build rotation: columns = local x,y,z in world, then apply pitch (about local z) and roll (about local x)
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    // local axes after pitch (bow up positive) and roll (starboard down positive)
    let ex = [cp, sp, 0], ey = [-sp, cp, 0], ez = [0, 0, 1];
    // roll about ex by angle: starboard (z) down for positive roll
    const ey2 = [ey[0] * cr - ez[0] * sr, ey[1] * cr - ez[1] * sr, ey[2] * cr - ez[2] * sr], ez2 = [ez[0] * cr + ey[0] * sr, ez[1] * cr + ey[1] * sr, ez[2] * cr + ey[2] * sr];
    const W = (v) => [f[0] * v[0] + up[0] * v[1] + rgt[0] * v[2], f[1] * v[0] + up[1] * v[1] + rgt[1] * v[2], f[2] * v[0] + up[2] * v[1] + rgt[2] * v[2]];
    const X = W(ex), Y = W(ey2), Z = W(ez2);
    const m = new Float32Array(16); m.set([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, this.pos[0], this.heave, this.pos[1], 1]);
    this.model = m;
    this.dist += this.speed * dt;
    this.updateSails(dt, waves.time || 0);
    // probe points in world
    this.probePts = this.probeLocal.map(([lx, lz]) => [this.pos[0] + c * lx + rgt[0] * lz, this.pos[1] + s * lx + rgt[2] * lz]);
    this.f = f; this.rgt = rgt;
    this.footprint = [this.pos[0], this.pos[1], c, s];
    gset('uYacht', [this.pos[0], this.heave, this.pos[1], this.heading]);
  }
  updateSails(dt, time) {
    const mx = 1.55, dY = HULL.deckY(mx, 0), SN = this.SN, ST = this.ST, out = this.sailVerts, nv = (SN + 1) * (ST + 1);
    const fl = this.flutter, ph = time * 5.3;
    const P = [];
    // ---- main sail
    {
      const sgn = this.sailMain >= 0 ? 1 : -1, a = Math.abs(this.sailMain);
      const headY = dY + 16.4, boomY = dY + 1.5, L0 = 4.55;
      for (let j = 0; j <= SN; j++) for (let i = 0; i <= ST; i++) {
        const s = j / SN, t = i / ST;
        const y = boomY + s * (headY - boomY);
        const aa = a + 0.20 * s * s + fl * 0.25 * Math.sin(ph * 0.6 + s * 3);            // twist opens the leech
        const bd = [-Math.cos(aa), 0, sgn * Math.sin(aa)];
        const Lc = L0 * ((1 - s) + 0.22 * Math.sin(Math.PI * s) * (1 - s * s * 0.5)) + 0.02;
        const nrm = [sgn * Math.sin(aa), 0, sgn * sgn * Math.cos(aa) * 0 + sgn * 0]; // placeholder, computed below
        const side = [-sgn * (-Math.sin(aa)) * 0, 0, 0];
        // out-of-plane direction: horizontal, perpendicular to boom, on the leeward (sgn) side
        let o = [Math.sin(aa) * 1.0, 0, sgn * Math.cos(aa)]; o = M.v3.norm([o[0] * sgn * sgn, 0, o[2]]);
        const draft = (0.17 * (1 - 0.30 * s)) * Lc * 4 * t * (1 - t) * (0.55 + 0.45 * (1 - t)) * (1 - 0.6 * fl);
        const flap = fl * 0.45 * Lc * Math.sin(ph + t * 7 + s * 5) * t * (0.4 + 0.6 * Math.sin(ph * 0.5 + s * 2));
        const x = mx + bd[0] * t * Lc + o[0] * (draft + flap), z = bd[2] * t * Lc + o[2] * (draft + flap);
        P.push([x, y, z, t, s]);
      }
    }
    // ---- jib
    {
      const sgn = this.sailJib >= 0 ? 1 : -1, a = Math.abs(this.sailJib);
      const T = [HULL.xAt(1, 1) - 0.28, HULL.deckY(6.3, 0) + 0.35, 0], H = [mx + 0.28, dY + 15.0, 0];
      const C = [0.35 - 0.7 * Math.sin(a), dY + 1.75, sgn * (0.45 + 4.0 * Math.sin(a * 0.9))];
      for (let j = 0; j <= SN; j++) for (let i = 0; i <= ST; i++) {
        const s = j / SN, t = i / ST;
        const sagL = 0.10 * Math.sin(Math.PI * s);
        const L = [T[0] + (H[0] - T[0]) * s, T[1] + (H[1] - T[1]) * s, 0 - 0];
        const Cm = [C[0] + (H[0] - C[0]) * s + 0.0, C[1] + (H[1] - C[1]) * s, C[2] * (1 - s * 0.92)];
        const chord = [Cm[0] - L[0], Cm[1] - L[1], Cm[2] - L[2]];
        const cl = M.v3.len(chord);
        let n = M.v3.norm(M.v3.cross(chord, [H[0] - T[0], H[1] - T[1], 0])); if (n[2] * sgn < 0) n = M.v3.mul(n, -1);
        const draft = 0.19 * cl * 4 * t * (1 - t) * (1 - 0.3 * s) * (1 - 0.7 * fl);
        const flap = fl * 0.55 * cl * Math.sin(ph * 1.2 + t * 8 + s * 4) * t;
        P.push([L[0] + chord[0] * t + n[0] * (draft + flap) + sagL * 0.0, L[1] + chord[1] * t + n[1] * (draft + flap), L[2] + chord[2] * t + n[2] * (draft + flap), t, s]);
      }
    }
    // normals + write
    for (let k = 0; k < 2; k++) {
      const off = k * nv, at = (j, i) => P[off + Math.min(SN, Math.max(0, j)) * (ST + 1) + Math.min(ST, Math.max(0, i))];
      for (let j = 0; j <= SN; j++) for (let i = 0; i <= ST; i++) {
        const p = at(j, i), du = M.v3.sub(at(j, i + 1), at(j, i - 1)), dv = M.v3.sub(at(j + 1, i), at(j - 1, i));
        let n = M.v3.norm(M.v3.cross(dv, du));
        const o = (off + j * (ST + 1) + i) * 9;
        out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = n[0]; out[o + 4] = n[1]; out[o + 5] = n[2]; out[o + 6] = p[3]; out[o + 7] = p[4] * (k ? 1.6 : 2.4); out[o + 8] = k ? 6 : 5;
      }
    }
    const gl = this.g.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.sailVbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
    this.sailPts = P;
    this.uploadLines();
  }
  uploadLines() {
    const gl = this.g.gl, mx = 1.55, dY = HULL.deckY(mx, 0);
    const L = this.lines.slice();
    // dynamic sheets: boom end to deck, jib sheets
    const sm = this.sailPts; if (sm) {
      const clewMain = sm[(this.SN) * (this.ST + 1) * 0 + this.ST], nvv = (this.SN + 1) * (this.ST + 1);
      const jc = sm[nvv + this.ST];   // jib clew (s=0,t=1)
      const sgn = this.sailJib >= 0 ? 1 : -1;
      L.push([clewMain[0], clewMain[1], clewMain[2], 0.014, clewMain[0] + 0.3, HULL.deckY(-4.2, 0) + 0.15, 0.0, 0.014]);
      L.push([jc[0], jc[1], jc[2], 0.012, -1.6, HULL.deckY(-1.6, sgn * 1.7) + 0.1, sgn * 1.7, 0.012]);
    }
    const buf = new Float32Array(L.length * 8); L.forEach((l, i) => buf.set(l, i * 8));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf); this.nLines = L.length;
  }
  shadowMatrix(sunDir) {
    const c = [this.pos[0], 3.5, this.pos[1]]; const up = Math.abs(sunDir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    const eye = M.v3.add(c, M.v3.mul(sunDir, 60));
    const V = M.lookAt(eye, c, up), P = M.ortho(-15, 15, -15, 15, 5, 120);
    this.lightVP = M.mul(P, V); return this.lightVP;
  }
  renderShadow(lightDir) {
    const g = this.g, gl = g.gl;
    if (lightDir[1] < 0.02) { this.shadowValid = false; }
    this.shadowValid = true;
    g.bind(this.shadowFbo); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.colorMask(false, false, false, false);
    const p = this.shadowProg.use(); p.m4('uModel', this.model).m4('uLightVP', this.shadowMatrix(lightDir));
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.drawElements(gl.TRIANGLES, this.nStatic, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(this.sailVao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sailIbo); gl.drawElements(gl.TRIANGLES, this.sailIdx.length, gl.UNSIGNED_INT, 0);
    gl.colorMask(true, true, true, true);
  }
  draw(sky, waves) {
    const g = this.g, gl = g.gl, p = this.prog.use();
    sky.bindSkyUniforms(p);
    p.t('uEnv', sky.env).t('uAmb', sky.amb).t('uShadow', this.shadowTex).m4('uModel', this.model).m4('uLightVP', this.lightVP);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.drawElements(gl.TRIANGLES, this.nStatic, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(this.sailVao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sailIbo); gl.drawElements(gl.TRIANGLES, this.sailIdx.length, gl.UNSIGNED_INT, 0);
  }
  drawLines(sky) {
    const g = this.g, gl = g.gl, p = this.lineProg.use(); sky.bindSkyUniforms(p);
    p.m4('uModel', this.model);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.lineVao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIdx);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.nLines);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }
}
