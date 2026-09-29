'use strict';
// Ocean surface: geomorphing clipmap mesh + physically-motivated shading.

SH.waterVS = `
#include <common>
#include <cascades>
#include <cloud>
layout(location=0) in vec2 aPos;
uniform float uScale; uniform vec2 uCenter;
uniform vec4 uWake;                 // yacht-local ripple window: xy origin, z extent, w enabled
uniform sampler2D uWakeTex;
out vec2 vX0; out vec3 vWorld; out vec2 vSh; out float vFade;
void main(){
  vec2 p=aPos; float mg=smoothstep(0.72,1.0,max(abs(p.x),abs(p.y))/64.0);
  p-=mg*mod(p,2.0);
  vec2 x0=uCenter+p*uScale;
  vec2 dc=x0-uCam.xz; float d=length(dc);
  float sp=max(d/40.0,0.5);
  float lb=-0.5;
  float l0=max(log2(sp*uCasc.x*256.0)+lb,0.0), l1=max(log2(sp*uCasc.y*256.0)+lb,0.0), l2=max(log2(sp*uCasc.z*256.0)+lb,0.0), l3=max(log2(sp*uCasc.w*256.0)+lb,0.0);
  float w2=1.0-smoothstep(150.0,700.0,d), w3=1.0-smoothstep(25.0,160.0,d);
  vec3 D=textureLod(uDisp0,x0*uCasc.x,l0).xyz+textureLod(uDisp1,x0*uCasc.y,l1).xyz;
  D+=w2*textureLod(uDisp2,x0*uCasc.z,l2).xyz;
  D+=w3*textureLod(uDisp3,x0*uCasc.w,l3).xyz;
  vec3 wp=vec3(x0.x+D.x,D.y,x0.y+D.z);
  if(uWake.w>0.5){
    vec2 wuv=(wp.xz-uWake.xy)/uWake.z;
    if(all(greaterThan(wuv,vec2(0.02)))&&all(lessThan(wuv,vec2(0.98)))){
      vec2 e=min(min(wuv,1.0-wuv)/0.06,vec2(1.0)); float sr=max(uScale,0.5)*0.9/uWake.z; float hh=0.2*textureLod(uWakeTex,wuv,0.0).x+0.2*(textureLod(uWakeTex,wuv+vec2(sr,0.0),0.0).x+textureLod(uWakeTex,wuv-vec2(sr,0.0),0.0).x+textureLod(uWakeTex,wuv+vec2(0.0,sr),0.0).x+textureLod(uWakeTex,wuv-vec2(0.0,sr),0.0).x); wp.y+=hh*min(e.x,e.y);
    }
  }
  vec2 hd=wp.xz-uCam.xz; wp.y-=dot(hd,hd)/(2.0*6.371e6);
  vWorld=wp; vX0=x0;
  vSh=vec2(cloudShadowAt(vec3(x0.x,0.0,x0.y),uSunDir.xyz),cloudShadowAt(vec3(x0.x,0.0,x0.y),uMoonDir.xyz));
  vFade=d;
  gl_Position=uViewProj*vec4(wp,1.0);
}`;

SH.waterFS = `
#include <common>
#include <cascades>
#include <atmo>
#include <skyLookup>
#include <stars>
#include <uwCommon>
in vec2 vX0; in vec3 vWorld; in vec2 vSh; in float vFade;
layout(location=0) out vec4 o;
uniform samplerCube uEnv; uniform sampler2D uAmb, uFoam, uWakeTex, uFoamFar;
uniform vec2 uFoamOrigin, uFoamOriginF; uniform float uFoamExtent, uFoamExtentF;
uniform vec4 uWake;
uniform vec3 uBodyCol;
uniform float uFoamAmt;


vec4 texBS(sampler2D s, vec2 uv, float size){    // cubic B-spline through 4 bilinear taps (level 0)
  vec2 t=uv*size-0.5; vec2 f=fract(t); vec2 i=floor(t)+0.5;
  vec2 f2=f*f, f3=f2*f;
  vec2 w0=(1.0-3.0*f+3.0*f2-f3)/6.0, w1=(4.0-6.0*f2+3.0*f3)/6.0, w2=(1.0+3.0*f+3.0*f2-3.0*f3)/6.0, w3=f3/6.0;
  vec2 g0=w0+w1, g1=w2+w3; vec2 h0=(i-1.0+w1/g0)/size, h1=(i+1.0+w3/g1)/size;
  return g0.y*(g0.x*textureLod(s,vec2(h0.x,h0.y),0.0)+g1.x*textureLod(s,vec2(h1.x,h0.y),0.0))+g1.y*(g0.x*textureLod(s,vec2(h0.x,h1.y),0.0)+g1.x*textureLod(s,vec2(h1.x,h1.y),0.0));
}
vec4 slopeTex(sampler2D s, vec2 uv){
  vec2 px=uv*256.0; float foot=max(length(dFdx(px)),length(dFdy(px)));
  vec4 lin=texture(s,uv);
  float w=1.0-smoothstep(0.7,1.6,foot);
  return w>0.0?mix(lin,texBS(s,uv,256.0),w):lin;
}
float fresnelW(float c){ float n=1.333; float s2=(1.0-c*c)/(n*n); float ct=sqrt(max(1.0-s2,0.0)); float rs=(c-n*ct)/(c+n*ct), rp=(n*c-ct)/(n*c+ct); return 0.5*(rs*rs+rp*rp); }
vec3 ambCube(vec3 n){
  vec3 nn=n*n; vec3 c=vec3(0.0);
  c+=nn.x*texelFetch(uAmb,ivec2(n.x>0.0?0:1,0),0).rgb; c+=nn.y*texelFetch(uAmb,ivec2(n.y>0.0?2:3,0),0).rgb; c+=nn.z*texelFetch(uAmb,ivec2(n.z>0.0?4:5,0),0).rgb;
  return c;
}
float lambdaG(float s2,float c){ float t2=(1.0-c*c)/max(c*c,1e-3); return 0.5*(sqrt(1.0+2.0*s2*t2)-1.0); }
vec3 glint(vec3 L, vec3 E, vec3 V, vec2 sm, vec3 cv){
  vec3 H=normalize(L+V); if(H.y<=0.02||L.y<=0.0) return vec3(0.0);
  vec2 hs=-H.xz/H.y; vec2 d=hs-sm;
  float cn=H.y, ci=max(dot(L,H),0.05), cn4=cn*cn*cn*cn;
  float sv=1.3e-6/(ci*ci*cn4);
  float a=cv.x+sv, b=cv.z, c=cv.y+sv; float det=max(a*c-b*b,1e-14);
  float q=(c*d.x*d.x-2.0*b*d.x*d.y+a*d.y*d.y)/det;
  float P=exp(-0.5*min(q,80.0))/(TAU*sqrt(det));
  float F=fresnelW(sat(dot(H,V)));
  float s2=cv.x+cv.y;
  float G=1.0/(1.0+lambdaG(s2,max(V.y,0.02))+lambdaG(s2,max(L.y,0.02)));
  return E*F*G*P/(4.0*max(V.y,0.03)*cn4);
}
// ---- foam texture pieces
float worleyF(vec2 p, out float f2){
  ivec2 i=ivec2(floor(p)); vec2 f=fract(p); float d1=9.0,d2=9.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 r=h22(i+ivec2(x,y)); vec2 q=vec2(x,y)+r-f; float d=dot(q,q); if(d<d1){d2=d1;d1=d;} else if(d<d2) d2=d; }
  f2=sqrt(d2); return sqrt(d1);
}

vec2 rainRing(vec2 p, float cell, float rate, float seed){
  vec2 id=floor(p/cell), f=fract(p/cell); vec2 g=vec2(0.0);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    ivec2 c=ivec2(id)+ivec2(x,y); vec3 h=vec3(pcg3(uvec3(c.x,c.y,uint(seed)))&uvec3(65535u))/65535.0;
    vec2 ctr=vec2(x,y)+h.xy-f; float age=fract(uCam.w*rate*(0.7+0.6*h.z)+h.z*7.0);
    float r=age*0.55, d=length(ctr)*cell;
    float w=d-r; float env=exp(-w*w/(0.028*0.028))*sq(1.0-age);
    g+=normalize(ctr+1e-5)*env*sin(w*130.0)*0.55*(0.5+0.5*h.x);
  }
  return g;
}
void main(){
  vec3 Vv=uCam.xyz-vWorld; float dist=length(Vv); vec3 V=Vv/dist;
  vec2 x0=vX0;
  vec4 s0=texture(uSlope0,x0*uCasc.x), s1=slopeTex(uSlope1,x0*uCasc.y), s2=slopeTex(uSlope2,x0*uCasc.z), s3=slopeTex(uSlope3,x0*uCasc.w);
  vec4 m1=slopeTex(uMom1,x0*uCasc.y), m2=slopeTex(uMom2,x0*uCasc.z), m3=slopeTex(uMom3,x0*uCasc.w);
  float calm=1.0-smoothstep(0.0,3.0,uWind.w);
  // patchy small-scale wind cover (cat's paws) at low winds
  float gn=fbm2(x0*0.011+uWind.xy*uCam.w*0.6,4); float gust=mix(1.0,clamp(-0.25+2.5*smoothstep(0.36,0.62,gn),0.03,1.4),calm);
  vec2 mean=s0.xy+s1.xy+s2.xy*gust+s3.xy*gust;
  vec2 dd=max(vec2(1.0+s0.z+s1.z+s2.z*gust+s3.z*gust,1.0+s0.w+s1.w+s2.w*gust+s3.w*gust),vec2(0.4));
  vec3 vr1=vec3(max(m1.x-s1.x*s1.x,0.0),max(m1.y-s1.y*s1.y,0.0),m1.z-s1.x*s1.y);
  vec3 vr2=vec3(max(m2.x-s2.x*s2.x,0.0),max(m2.y-s2.y*s2.y,0.0),m2.z-s2.x*s2.y)*gust*gust;
  vec3 vr3=vec3(max(m3.x-s3.x*s3.x,0.0),max(m3.y-s3.y*s3.y,0.0),m3.z-s3.x*s3.y)*gust*gust;
  vec3 cvar=vr1+vr2+vr3+vec3(2.0e-5,2.0e-5,0.0);
  // rain ripples / wake
  vec2 extraSlope=vec2(0.0); float wakeFoam=0.0;
  if(uWake.w>0.5){
    vec2 wuv=(vWorld.xz-uWake.xy)/uWake.z;
    if(all(greaterThan(wuv,vec2(0.02)))&&all(lessThan(wuv,vec2(0.98)))){
      vec2 e=min(min(wuv,1.0-wuv)/0.06,vec2(1.0)); float ew=min(e.x,e.y);
      vec2 tx=vec2(2.0/1024.0);
      float hL=texture(uWakeTex,wuv-vec2(tx.x,0)).x, hR=texture(uWakeTex,wuv+vec2(tx.x,0)).x, hD=texture(uWakeTex,wuv-vec2(0,tx.y)).x, hU=texture(uWakeTex,wuv+vec2(0,tx.y)).x;
      extraSlope=vec2(hR-hL,hU-hD)*(0.5*512.0/uWake.z)*ew; wakeFoam=texture(uWakeTex,wuv).z*ew;
    }
  }
  if(uWx.y>0.02){
    float fadeR=1.0-smoothstep(15.0,60.0,vFade);
    if(fadeR>0.0){ vec2 rr=(rainRing(x0*1.0,0.42,1.3*uWx.y+0.2,3.0)+rainRing(x0+17.0,0.71,1.0*uWx.y+0.2,9.0))*fadeR*min(1.0,uWx.y*1.6); extraSlope+=rr; }
  }
  vec2 slope=mean+extraSlope;
  vec3 N=normalize(vec3(-slope.x/dd.x,1.0,-slope.y/dd.y));
  // ---------------- foam
  vec2 fuv=(x0-uFoamOrigin)/uFoamExtent;
  float foamD=0.0, foamF=0.0, nearW=0.0;
  vec2 fuvF=(x0-uFoamOriginF)/uFoamExtentF;
  if(all(greaterThan(fuvF,vec2(0.0)))&&all(lessThan(fuvF,vec2(1.0)))){
    vec4 fsF=texture(uFoamFar,fuvF); float edgeF=min(min(fuvF.x,1.0-fuvF.x),min(fuvF.y,1.0-fuvF.y));
    float feF=smoothstep(0.0,0.05,edgeF); foamD=fsF.x*feF; foamF=fsF.y*feF;
  }
  if(all(greaterThan(fuv,vec2(0.0)))&&all(lessThan(fuv,vec2(1.0)))){
    vec4 fs=texture(uFoam,fuv); float edge=min(min(fuv.x,1.0-fuv.x),min(fuv.y,1.0-fuv.y));
    nearW=smoothstep(0.0,0.10,edge); foamD=mix(foamD,fs.x,nearW); foamF=mix(foamF,fs.y,nearW);
  }
  foamD*=uFoamAmt; foamD=max(foamD,wakeFoam*0.62); foamF=max(foamF,wakeFoam*0.55);
  float foam=0.0; vec3 foamN=N; float foamShade=1.0; float thick=0.0;
  if(foamD>0.004){
    vec2 wd=uWind.xy; vec2 pp=x0;
    float al=dot(pp,wd), cr=dot(pp,vec2(-wd.y,wd.x));
    float aniso=mix(1.4,2.8,1.0-foamF);                                 // fresh foam blobby, old foam drawn out into streaks
    vec2 sp=vec2(al/aniso,cr);
    vec2 wq=sp+0.85*vec2(gnoiseD(sp*0.5+vec2(3.1,7.7)).x,gnoiseD(sp*0.5+11.0).x);   // domain warp
    float dfade=smoothstep(10.0,110.0,dist);
    float n1=0.5+0.5*gnoiseD(wq*1.0).x, n2=0.5+0.5*gnoiseD(wq*2.6+3.0).x, n3=mix(0.5+0.5*gnoiseD(wq*6.5+7.0).x,0.5,dfade), n4=mix(0.5+0.5*gnoiseD(wq*15.0+1.0).x,0.5,dfade);
    float rid=mix(1.0-abs(gnoiseD(wq*4.2+2.0).x)*1.7,0.35,dfade);
    float f2; float w1=worleyF(pp*5.0,f2); float bub=mix(smoothstep(0.08,0.7,w1),0.8,dfade);
    float nz=0.42*n1+0.31*n2+0.14*n3+0.02*n4+0.08*clamp(rid,0.0,1.0);
    float dens=foamD*(0.70+0.75*foamF);
    float t=(nz-0.5)*3.1+dens*1.7-0.42-0.02*(1.0-bub)*(1.0-foamF);
    foam=smoothstep(-0.12,0.42,t)*smoothstep(0.02,0.10,foamD);
    thick=smoothstep(0.1,1.1,t);
    float wsolid=smoothstep(0.30,0.70,wakeFoam); foam=max(foam,wsolid*(0.72+0.25*n2)); thick=max(thick,wsolid*0.8);
    foamShade=mix(0.80,1.0,thick)*mix(0.70,1.0,n1)*mix(0.82,1.0,n2)*mix(0.9,1.0,n3);
    vec2 gb=gnoiseD(wq*1.2+3.0).yz*0.035;
    vec3 Nlow=normalize(vec3(-(s0.x+s1.x+extraSlope.x)/dd.x,1.0,-(s0.y+s1.y+extraSlope.y)/dd.y));   // foam damps the small ripples
    foamN=normalize(mix(Nlow,N,0.15)+vec3(-gb.x,0.0,-gb.y));
  }
  if(uFog.y==3.0){ o=vec4(vec3(foam),1.0); return; }
  if(uFog.y==4.0){ o=vec4(vec3(foamD),1.0); return; }

  if(uMisc.x>0.5){
    vec3 Iw=normalize(vWorld-uCam.xyz);              // camera -> surface (upwards)
    vec3 Nd=-N;
    float ci=sat(dot(-Iw,Nd));
    vec3 Tt=refract(Iw,Nd,1.333);
    float zc=max(-uCam.y,0.0);
    vec3 ambU=texelFetch(uAmb,ivec2(2,0),0).rgb;
    vec3 eq=ambU*exp(-UW_KD*zc)*vec3(0.030,0.100,0.150)*0.9;
    vec3 col2;
    float a2=cvar.x+cvar.y;
    if(dot(Tt,Tt)<1e-4){ col2=eq*1.0; }
    else {
      float Fu=fresAir(ci); float s2=(1.0-ci*ci)*1.333*1.333; float ct=sqrt(max(1.0-s2,0.0));
      float rs=(1.333*ci-ct)/(1.333*ci+ct), rp=(ci-1.333*ct)/(ci+1.333*ct); Fu=0.5*(rs*rs+rp*rp);
      vec3 sk=textureLod(uEnv,vec3(Tt.x,abs(Tt.y),Tt.z),clamp(log2(sqrt(a2)*256.0*0.9+1.0),0.0,7.0)).rgb;
      float wdt=max(0.0047*0.8,sqrt(a2)*0.7); float ang=acos(clamp(dot(Tt,uSunDir.xyz),-1.0,1.0));
      vec3 sunT=uSunCol.rgb*vSh.x*(1.0-Fu)/(TAU*wdt*wdt)*exp(-0.5*sq(ang/wdt))*step(0.0,uSunDir.y)*0.02;
      float angm=acos(clamp(dot(Tt,uMoonDir.xyz),-1.0,1.0));
      sunT+=uMoonCol.rgb*(1.0-Fu)/(TAU*wdt*wdt)*exp(-0.5*sq(angm/wdt))*step(0.0,uMoonDir.y)*0.02;
      col2=(sk*(1.0-Fu)+sunT)+eq*Fu;
      col2*=vec3(0.92,0.98,1.0);
    }
    vec3 fc=vec3(0.55,0.72,0.78)*(ambU*0.9+uSunCol.rgb*0.06)*exp(-UW_KD*zc);
    col2=mix(col2,fc,foam*0.85);
    o=vec4(min(col2,vec3(60000.0)),dist); return;
  }
  // ---------------- lighting
  vec3 sunE=uSunCol.rgb*vSh.x, moonE=uMoonCol.rgb*vSh.y;
  vec3 amb=ambCube(vec3(0.0,1.0,0.0));
  float NLs=sat(dot(N,uSunDir.xyz)), NLm=sat(dot(N,uMoonDir.xyz));
  vec3 Ed=sunE*sat(0.15+0.85*NLs)/PI*1.0+moonE*sat(0.15+0.85*NLm)/PI+amb*sat(0.5+0.5*N.y);
  // body colour + subsurface glow through thin crests lit from behind
  float sea=uWind.w;
  vec3 body=uBodyCol;
  body=mix(body,vec3(0.10,0.16,0.13)*0.9,sat(uWx.z*0.6+0.05*max(sea-6.0,0.0)));
  vec3 Lw=body*Ed;
  float hgt=vWorld.y;
  float back=pow(sat(dot(normalize(vec3(-uSunDir.x,0.0,-uSunDir.z)+1e-4),normalize(vec3(V.x,0.0,V.z)+1e-4))),3.0)*sat(uSunDir.y*3.0);
  float crest=sat(0.5+hgt*0.35)*pow(sat(0.55-0.5*dot(N,uSunDir.xyz)),2.0);
  Lw+=vec3(0.02,0.16,0.14)*sunE/PI*back*crest*1.4;
  // reflection
  float cv=sat(dot(N,V)); float F=fresnelW(cv);
  vec3 R=reflect(-V,N);
  float below=smoothstep(0.05,-0.35,R.y);
  vec3 Rf=vec3(R.x,abs(R.y),R.z);
  float alpha2=cvar.x+cvar.y;
  float lod=clamp(log2(sqrt(alpha2)*256.0*0.9+1.0),0.0,8.0);
  vec3 refl=textureLod(uEnv,Rf,lod).rgb;
  float pixA=length(fwidth(V))+1e-4;
  if(uNight.w>0.001 && alpha2<0.002){ refl+=starField(Rf,max(pixA,0.0005))*uNight.w*smoothstep(0.02,0.2,Rf.y)*(1.0-smoothstep(0.0,0.002,alpha2)); }
  refl=mix(refl,Lw*1.4,below*0.75);
  vec3 col=Lw*(1.0-F)+refl*F;
  // sun and moon glitter
  vec3 gl=glint(uSunDir.xyz,sunE,V,mean,cvar)+glint(uMoonDir.xyz,moonE,V,mean,cvar);
  col+=min(gl,vec3(20000.0))*(1.0-foam);
  // foam shading: diffuse, translucent at the edges
  if(foam>0.0){
    vec3 fE=sunE*sat(dot(foamN,uSunDir.xyz)*0.8+0.25)/PI+moonE*sat(dot(foamN,uMoonDir.xyz)*0.8+0.25)/PI+amb*(0.75+0.25*foamN.y)*1.25;
    fE=mix(fE,vec3(lum(fE)),0.55);
    vec3 fcol=vec3(0.95,0.96,0.97)*fE*foamShade*mix(0.85,1.05,foamF)*1.6;
    fcol=mix(fcol,fcol*vec3(0.75,0.95,0.95)+Lw*0.5,0.28*(1.0-foamF));
    col=mix(col,fcol+Lw*0.25*(1.0-thick),sat(foam*0.97));
  }
  // aerial perspective
  float vis=uFog.x;
  float T=exp(-dist/vis);
  vec3 hd=normalize(vec3(-V.x,0.0,-V.z)+vec3(0.0,0.0,1e-5));
  vec3 fogc=skyView(normalize(vec3(hd.x,0.004+0.02*uWx.y,hd.z)));
  fogc=mix(fogc,vec3(lum(fogc))*vec3(0.93,0.99,1.06),0.55); fogc*=mix(1.0,0.75,uWx.z);
  col=col*T+fogc*(1.0-T);
  o=vec4(min(col,vec3(60000.0)),dist);
}`;

class Water {
  constructor(g) {
    this.g = g; const gl = g.gl;
    this.prog = g.program('water', SH.waterVS, SH.waterFS);
    const H = 64, n = 2 * H + 1, verts = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { verts[(y * n + x) * 2] = x - H; verts[(y * n + x) * 2 + 1] = y - H; }
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const build = (hole) => {
      const idx = [];
      for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
        const gx = x - H, gy = y - H;
        if (hole && gx >= -H / 2 + 2 && gx + 1 <= H / 2 - 2 && gy >= -H / 2 + 2 && gy + 1 <= H / 2 - 2) continue;
        const a = y * n + x, b = a + 1, c = a + n, d = c + 1;
        if ((x + y) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
      }
      const b = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
      return { b, n: idx.length };
    };
    this.full = build(false); this.ring = build(true);
    this.levels = 13; this.s0 = 0.5;
    this.bodyCol = [0.020, 0.070, 0.095];
  }
  draw(waves, sky, env, camPos, foamAmt, wake) {
    const g = this.g, gl = g.gl, p = this.prog.use();
    waves.bindCascades(p); sky.bindSkyUniforms(p);
    p.t('uEnv', sky.env).t('uAmb', sky.amb).t('uFoam', waves.foam[waves.foamCur]).v2('uFoamOrigin', waves.foamOrigin[0], waves.foamOrigin[1])
      .t('uFoamFar', waves.foamFar[waves.farCur]).v2('uFoamOriginF', waves.farOrigin[0], waves.farOrigin[1]).f('uFoamExtentF', waves.farExtent).f('uFoamExtent', waves.foamExtent).v3('uBodyCol', this.bodyCol[0], this.bodyCol[1], this.bodyCol[2]).f('uFoamAmt', foamAmt);
    if (wake && wake.on) p.t('uWakeTex', wake.heightTex).v4('uWake', wake.origin[0], wake.origin[1], wake.extent, 1); else p.v4('uWake', 0, 0, 1, 0);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    for (let i = 0; i < this.levels; i++) {
      const s = this.s0 * (1 << i), step = 2 * s;
      const cx = Math.floor(camPos[0] / step) * step, cz = Math.floor(camPos[2] / step) * step;
      p.f('uScale', s).v2('uCenter', cx, cz);
      const m = i === 0 ? this.full : this.ring;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.b);
      gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
    }
  }
}
