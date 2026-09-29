'use strict';
// Sky: transmittance + sky-view LUT, tileable noise volumes, volumetric clouds, stars/moon/sun, env cubemap, ambient cube.

SH.noiseLib = `
int wrapi(int a,int p){ return ((a%p)+p)%p; }
float gperlin3(vec3 p, int per){
  ivec3 i0=ivec3(floor(p)); vec3 f=fract(p); vec3 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float v[8];
  for(int k=0;k<8;k++){
    ivec3 o=ivec3(k&1,(k>>1)&1,(k>>2)&1);
    ivec3 c=ivec3(wrapi(i0.x+o.x,per),wrapi(i0.y+o.y,per),wrapi(i0.z+o.z,per));
    vec3 g=normalize(h33(c)*2.0-1.0+1e-4);
    v[k]=dot(g,f-vec3(o));
  }
  return mix(mix(mix(v[0],v[1],u.x),mix(v[2],v[3],u.x),u.y), mix(mix(v[4],v[5],u.x),mix(v[6],v[7],u.x),u.y), u.z);
}
float worley3(vec3 p, int per){
  ivec3 i0=ivec3(floor(p)); vec3 f=fract(p); float d=1e9;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    ivec3 o=ivec3(x,y,z); ivec3 c=ivec3(wrapi(i0.x+x,per),wrapi(i0.y+y,per),wrapi(i0.z+z,per));
    vec3 r=h33(c); vec3 q=vec3(o)+r-f; d=min(d,dot(q,q));
  }
  return sqrt(d);
}
float gperlin2(vec2 p,int per){
  ivec2 i0=ivec2(floor(p)); vec2 f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float v[4];
  for(int k=0;k<4;k++){ ivec2 o=ivec2(k&1,k>>1); ivec2 c=ivec2(wrapi(i0.x+o.x,per),wrapi(i0.y+o.y,per));
    float a=h21(c+ivec2(91,37))*TAU; v[k]=dot(vec2(cos(a),sin(a)),f-vec2(o)); }
  return mix(mix(v[0],v[1],u.x),mix(v[2],v[3],u.x),u.y);
}`;

SH.noise3FS = `
#include <common>
#include <noiseLib>
in vec2 vUV; out vec4 o; uniform float uSlice;
void main(){
  vec3 p=vec3(vUV,(uSlice+0.5)/128.0);
  float pf=gperlin3(p*4.0,4)*0.55+gperlin3(p*8.0,8)*0.30+gperlin3(p*16.0,16)*0.15;
  pf=0.5+0.5*clamp(pf*1.7,-1.0,1.0);
  float w4=1.0-worley3(p*4.0,4), w8=1.0-worley3(p*8.0,8), w16=1.0-worley3(p*16.0,16), w32=1.0-worley3(p*32.0,32);
  float wf=w8*0.625+w16*0.25+w32*0.125;
  float pw=clamp(remap(pf,0.0,1.0,wf*0.6,1.0),0.0,1.0);
  o=vec4(pw, w8, w16, w32);
}`;
SH.weatherFS = `
#include <common>
#include <noiseLib>
in vec2 vUV; out vec4 o;
void main(){
  vec2 p=vUV;
  float a=0.0,amp=0.5,tot=0.0; for(int i=0;i<6;i++){ int per=4<<i; a+=amp*gperlin2(p*float(per),per); tot+=amp; amp*=0.52; }
  a=0.5+0.5*clamp(a/tot*2.4,-1.0,1.0);
  float b=0.0; amp=0.5; tot=0.0; for(int i=0;i<5;i++){ int per=8<<i; b+=amp*gperlin2(p*float(per)+vec2(31.0,7.0),per); tot+=amp; amp*=0.55; }
  b=0.5+0.5*clamp(b/tot*2.4,-1.0,1.0);
  float c=0.5+0.5*clamp(gperlin2(p*3.0+vec2(5.0,9.0),3)*1.8,-1.0,1.0);
  o=vec4(a,b,c,1.0);
}`;

// ---------------------------------------------------------------- stars / moon
SH.stars = `
vec3 starField(vec3 rd, float pix){
  vec3 col=vec3(0.0);
  for(int l=0;l<3;l++){
    float sc=l==0?70.0:(l==1?130.0:230.0);
    vec3 p=rd*sc; ivec3 c=ivec3(floor(p)); vec3 f=fract(p);
    vec3 h=h33(c+ivec3(l*131,7*l,3)); float pr=h31(c+ivec3(17,l,91));
    if(pr>(l==0?0.10:(l==1?0.16:0.22))) continue;
    vec3 sp=0.28+0.44*h33(c+ivec3(5,l*3,77));
    float r=length(f-sp);
    float sg=max(pix*sc*0.55,0.02);
    float mag=pow(h,vec3(3.0)).x;                     // brightness distribution
    float flux=mix(0.04,1.0,mag)*(l==0?2.0:(l==1?0.9:0.35));
    float I=flux*exp(-0.5*r*r/(sg*sg))*sq(0.018/sg);
    float tmp=h.y; vec3 tint=mix(vec3(1.0,0.78,0.6),vec3(0.65,0.78,1.0),tmp);
    col+=tint*min(I*4.0,6.0);
  }
  return col;
}
vec3 milkyWay(vec3 rd){
  vec3 n=normalize(vec3(0.35,0.62,-0.70));
  vec3 t1=normalize(cross(n,vec3(0.0,1.0,0.0))), t2=cross(n,t1);
  float b=dot(rd,n), u=atan(dot(rd,t2),dot(rd,t1));
  float band=exp(-b*b/0.030);
  float cloudN=fbm2(vec2(u*6.0,b*13.0),5);
  float fine=fbm2(vec2(u*24.0,b*55.0)+3.0,4);
  float dust=smoothstep(0.50,0.66,fbm2(vec2(u*9.0+2.0,b*26.0),4))*exp(-b*b/0.006);
  float core=exp(-b*b/0.008)*smoothstep(-1.0,1.0,cos(u*1.0-0.6));
  vec3 c=vec3(0.50,0.56,0.72)*band*(0.30+0.85*cloudN)*(0.65+0.7*fine)*(1.0-0.75*dust);
  c+=vec3(0.75,0.62,0.45)*core*(0.4+0.6*cloudN)*(1.0-0.6*dust)*0.7;
  return c*0.30;
}`;

// ---------------------------------------------------------------- clouds
SH.cloud = `
uniform sampler2D uWeather; uniform sampler3D uNoise3;
const float CL_SIGMA=0.075;
float cloudSigma(){ return CL_SIGMA*mix(1.0+uWx.z,0.45+1.3*uWx.z,uCloud.z); }
float hgp(float c,float g){ float g2=g*g; return (1.0-g2)/(4.0*PI*pow(1.0+g2-2.0*g*c,1.5)); }
float cloudPresence(vec2 xz){
  vec2 q=(xz+uDrift.xy)/34000.0;
  vec4 w=textureLod(uWeather,q,0.0);
  float cov=smoothstep(0.26,0.76,w.r*0.66+w.g*0.34);
  float c=min(uWx.x,mix(1.0,0.90,uWx.z))*1.12;
  return smoothstep(1.0-c-0.04,1.0-c+0.36,cov);
}
// detail: 1 = full erosion, 0 = base shape only
float cloudDensity(vec3 p, float detail){
  float hf=(p.y-uCloud.x)/uCloud.y;
  if(hf<=0.0||hf>=1.0) return 0.0;
  float pres=cloudPresence(p.xz);
  if(pres<=0.001) return 0.0;
  vec3 q=p+vec3(uDrift.x,0.0,uDrift.y);
  vec4 n=textureLod(uNoise3,vec3(q.x,q.y*0.35,q.z)/7000.0,0.0);
  float typeV=textureLod(uWeather,(p.xz+uDrift.xy)/34000.0+vec2(0.37,0.11),0.0).g;
  float top=mix(clamp((0.30+0.70*pres)*mix(0.55,1.30,typeV),0.18,1.0),0.92,uCloud.z);
  float hgrad=smoothstep(0.0,mix(0.07,0.10,uCloud.z),hf-0.10*uCloud.z*(1.0-n.g)*(1.0-n.b*0.5))*smoothstep(top,top*0.45,hf);
  float base=n.r*hgrad;
  base=clamp(remap(base,1.0-pres,1.0,0.0,1.0),0.0,1.0);
  if(detail>0.0){
    vec4 m=textureLod(uNoise3,vec3(q.x,q.y*0.55,q.z)/2500.0+vec3(0.31,0.0,0.17),0.0);
    vec4 m2=textureLod(uNoise3,vec3(q.x,q.y*0.55,q.z)/1700.0+vec3(0.11,0.4,0.62),0.0);
    float wor=m.g*0.62+m.b*0.28+m2.g*0.10;
    float er=mix(wor,1.0-wor,clamp(hf*4.0,0.0,1.0))*detail*mix(0.44,0.42,uCloud.z);
    base=clamp(remap(base,er,1.0,0.0,1.0),0.0,1.0);
  }
  return base;
}
float cloudShadowAt(vec3 p, vec3 L){   // sun/moon visibility through the cloud layer from a sea point
  if(L.y<0.015) return 1.0;
  float t0=(uCloud.x-p.y)/L.y, t1=(uCloud.x+uCloud.y-p.y)/L.y, tau=0.0;
  for(int i=0;i<5;i++){ float t=mix(t0,t1,(float(i)+0.5)/5.0); tau+=cloudDensity(p+L*t,0.0)*(t1-t0)/5.0; }
  return exp(-tau*cloudSigma()*0.7);
}
float lightTau(vec3 p, vec3 L, int NL){
  float tau=0.0, s=45.0, t=0.0;
  for(int i=0;i<6;i++){ if(i>=NL) break; t+=s*0.5; tau+=cloudDensity(p+L*t,0.0)*s; t+=s*0.5; s*=1.9; }
  return tau*cloudSigma();
}
float msPhase(float c,float tau){
  float s=0.0,a=1.0,b=1.0,cc=1.0;
  for(int n=0;n<3;n++){ float g=0.55*cc; s+=b*(0.72*hgp(c,g)+0.28*hgp(c,-0.3*cc))*exp(-tau*a); a*=0.5; b*=0.55; cc*=0.55; }
  return s;
}
#ifdef HAS_BOLT
uniform vec4 uFlashPos;
#endif
// returns rgb radiance and alpha=transmittance; tHit = mean distance of scattering
vec4 cloudMarch(vec3 ro, vec3 rd, int N, int NL, float jit, vec3 ambTop, out float tHit){
  float base=uCloud.x, top=uCloud.x+uCloud.y, ty0,ty1;
  tHit=1e5;
  if(abs(rd.y)<1e-4){ if(ro.y<base||ro.y>top) return vec4(0,0,0,1); ty0=0.0; ty1=60000.0; }
  else { float a=(base-ro.y)/rd.y,b=(top-ro.y)/rd.y; ty0=min(a,b); ty1=max(a,b); }
  ty0=max(ty0,0.0); ty1=min(ty1,60000.0);
  if(ty1<=ty0) return vec4(0,0,0,1);
  float len=ty1-ty0;
  vec3 L0=uSunDir.xyz, L1=uMoonDir.xyz; vec3 E0=uCSun.rgb*(1.0-0.80*uWx.z), E1=uCMoon.rgb*(1.0-0.80*uWx.z);
  float c0=dot(rd,L0), c1=dot(rd,L1);
  bool useSun=lum(E0)>0.0, useMoon=lum(E1)>0.0;
  vec3 col=vec3(0.0); float T=1.0, tw=0.0, wsum=0.0;
  for(int i=0;i<N;i++){
    float s=(float(i)+jit)/float(N), s2=(float(i)+1.0+jit)/float(N);
    float t=ty0+len*s*s, ds=len*(s2*s2-s*s);
    vec3 p=ro+rd*t;
    float dn=cloudDensity(p,1.0);
    if(dn>0.003){ dn=0.5*(dn+cloudDensity(p-rd*(0.5*ds),1.0));
      if(dn<=0.003) continue;
      float hf=(p.y-base)/(top-base);
      float ext=cloudSigma()*dn*ds;
      vec2 vq=(p.xz+uDrift.xy);
      float lv=mix(0.55,1.45,textureLod(uWeather,vq/26000.0,0.0).b)*mix(0.7,1.3,textureLod(uNoise3,vec3(vq.x,p.y*0.5,vq.y)/5200.0,0.0).g);
      vec3 S=ambTop*mix(0.30,1.0,smoothstep(0.0,0.9,hf))*(1.0-0.55*uWx.z)*mix(1.0,lv,0.35+0.65*uWx.z);
      if(useSun){ float tau=lightTau(p,L0,NL); S+=E0*lv*(msPhase(c0,tau)+0.85/PI*(mix(0.16,0.07,uWx.z)+0.84*exp(-tau*0.07))); }
      if(useMoon){ float tau=lightTau(p,L1,NL); S+=E1*(msPhase(c1,tau)+0.85/PI*(0.16+0.84*exp(-tau*0.07))); }
#ifdef HAS_BOLT
      if(uFlashPos.w>0.0){ vec3 dv=uFlashPos.xyz-p; float dd=dot(dv,dv); S+=vec3(0.75,0.85,1.0)*uFlashPos.w*5.0/(1.0+dd/(2600.0*2600.0))*(0.4+0.6*hf); }
#endif
      float a=1.0-exp(-ext);
      col+=T*S*a; tw+=t*T*a; wsum+=T*a; T*=1.0-a;
      if(T<0.02){ T=0.0; break; }
    }
  }
  tHit=wsum>0.0?tw/wsum:ty1;
  return vec4(col,T);
}`;

// ---------------------------------------------------------------- lightning bolt distance field (sky shader)
SH.bolt = `
uniform vec4 uBoltSeg[64];   // xyz point, w unused ; consecutive points form a polyline (w<0 = break)
uniform int uBoltN;
float segRayDist(vec3 ro, vec3 rd, vec3 a, vec3 b, out float tAlong){
  vec3 u=b-a, w=a-ro; float A=dot(u,u), B=dot(u,rd), D=dot(u,w), E=dot(rd,w);
  float den=A-B*B; float s=den>1e-6?(B*E-D)/den:0.0; s=clamp(s,0.0,1.0);
  vec3 pa=a+u*s; float t=max(dot(pa-ro,rd),0.0); tAlong=t;
  return length(ro+rd*t-pa);
}
vec3 boltGlow(vec3 ro, vec3 rd){
  vec3 acc=vec3(0.0);
  for(int i=0;i<63;i++){
    if(i+1>=uBoltN) break;
    vec4 a=uBoltSeg[i], b=uBoltSeg[i+1];
    if(b.w<0.0) continue;
    float ta; float d=segRayDist(ro,rd,a.xyz,b.xyz,ta);
    float w=b.w>0.5?1.0:0.35;               // branches thinner
    float ang=d/max(ta,1.0);
    float core=exp(-sq(ang/(0.0009*w+1e-5)));
    float glow=exp(-sq(ang/(0.010*w+1e-5)))*0.5+exp(-sq(ang/(0.045*w+1e-5)))*0.08;
    acc+=vec3(0.80,0.88,1.0)*(core*90.0+glow*12.0);
  }
  return acc;
}`;

// ---------------------------------------------------------------- sky pass (main view + cubemap faces)
SH.skyFS = `
#define HAS_BOLT
#define USE_TRANS
#include <atmo>
#include <skyLookup>
#include <stars>
#include <cloud>
#include <bolt>
in vec2 vUV; layout(location=0) out vec4 o;
uniform int uFace;          // -1 main view, 0..5 cubemap face
uniform float uCloudQ;      // step multiplier
uniform vec3 uEnvOrigin;
vec3 faceDir(int f, vec2 uv){
  float s=uv.x*2.0-1.0,t=uv.y*2.0-1.0;
  if(f==0) return vec3(1.0,-t,-s); if(f==1) return vec3(-1.0,-t,s);
  if(f==2) return vec3(s,1.0,t);   if(f==3) return vec3(s,-1.0,-t);
  if(f==4) return vec3(s,-t,1.0);  return vec3(-s,-t,-1.0);
}
void main(){
  vec3 rd, ro; bool env=uFace>=0;
  if(env){ rd=normalize(faceDir(uFace,vUV)); ro=vec3(uEnvOrigin.x,2.0,uEnvOrigin.z); }
  else { vec4 w=uInvViewProj*vec4(vUV*2.0-1.0,1.0,1.0); rd=normalize(w.xyz/w.w-uCam.xyz); ro=uCam.xyz; }
  vec3 atm=skyView(rd);
  float horizon=smoothstep(-0.06,0.02,rd.y);
  // below horizon: continue with horizon colour so nothing breaks at the seam
  if(rd.y<0.0) atm=skyView(normalize(vec3(rd.x,0.0005,rd.z)));
  vec3 col=atm+uNight.rgb*(0.55+0.45*exp(-6.0*abs(rd.y)));
  float pix=env?(2.0/256.0):length(fwidth(rd));
  float visCl=uFog.x*1.6;
  vec3 up=skyView(vec3(0.0,1.0,0.0));
  vec3 ambTop=mix(up,vec3(lum(up)),clamp(0.35*uWx.x+0.6*uWx.z,0.0,0.95))*mix(1.0,0.75,uWx.z);
  ambTop*=1.0+uMisc.y*0.9;
  float ct=1.0; vec4 cl=vec4(0,0,0,1); float tHit=1e5;
  if(uWx.x>0.01 && rd.y>-0.01){
    float jit=ign(gl_FragCoord.xy,uCam.w*60.0);
    int N=env?int(18.0*uCloudQ):int(60.0*uCloudQ);
    cl=cloudMarch(ro,rd,N,env?3:5,jit,ambTop,tHit);
    ct=cl.a;
  }
  vec3 behind=col;
  if(!env && rd.y>-0.02){
    if(uNight.w>0.001){ behind+=(starField(rd,pix)+milkyWay(rd)*0.9)*uNight.w*smoothstep(0.0,0.18,rd.y); }
    // sun disc
    float rS=0.00465; float cs=dot(rd,uSunDir.xyz); float aS=acos(clamp(cs,-1.0,1.0));
    vec3 Ls=min(uSunCol.rgb/(PI*rS*rS),vec3(30000.0));
    float mu=sqrt(max(1.0-sq(aS/rS),0.0)); float limb=0.45+0.55*mu;
    behind+=Ls*limb*(1.0-smoothstep(rS*0.94,rS*1.06+pix,aS))*step(-0.01,uSunDir.y+0.02);
    // moon disc with phase from the real sun direction
    float rM=0.0072; vec3 mdir=uMoonDir.xyz; float aM=acos(clamp(dot(rd,mdir),-1.0,1.0));
    if(aM<rM*1.3){
      vec3 rgt=normalize(cross(vec3(0,1,0),mdir)), upv=cross(mdir,rgt);
      vec2 lp=vec2(dot(rd-mdir,rgt),dot(rd-mdir,upv))/rM;   // disc coords
      float r2=dot(lp,lp);
      if(r2<1.0){
        vec3 n=normalize(-mdir*sqrt(1.0-r2)+rgt*lp.x+upv*lp.y);
        float lit=smoothstep(-0.03,0.08,dot(n,uSunDir.xyz));
        float mar=fbm2(lp*2.3+7.0,5); float cr=fbm2(lp*9.0,3);
        float alb=mix(0.42,1.0,smoothstep(0.38,0.62,mar))*(0.86+0.28*cr);
        vec3 Lm=min(uMoonCol.rgb*(1.0+0.0)/(PI*sq(0.0045)),vec3(9000.0));
        float edge=1.0-smoothstep(0.985,1.0,sqrt(r2))*0.4;
        vec3 mc=vec3(1.0,0.97,0.9)*Lm*alb*lit*edge*0.5;
        behind=mix(behind, behind*0.0+mc + atm*0.3, 1.0-smoothstep(0.985,1.0,sqrt(r2)));
      }
    }
  }
  float Tap=exp(-tHit/visCl);
  vec3 outc=behind*ct+cl.rgb*Tap+atm*(1.0-Tap)*(1.0-ct);
  // thin high cirrus, stretched along the wind; lit like the clouds so it goes pink at sunset
  if(rd.y>0.015 && uWx.z<0.85){
    float tc=(9500.0-ro.y)/rd.y; vec2 cp=ro.xz+rd.xz*tc+uDrift.xy*3.0;
    vec2 wdir=uWind.xy; float pa=dot(cp,wdir), pb=dot(cp,vec2(-wdir.y,wdir.x));
    float f=fbm2(vec2(pa*0.00020,pb*0.00070)+vec2(4.0,9.0),5), g2=fbm2(vec2(pa*0.0007,pb*0.0022)+11.0,4);
    float d=smoothstep(0.58,0.92,f*0.72+g2*0.42)*(0.34-0.18*uWx.x)*(1.0-uWx.z)*smoothstep(0.02,0.20,rd.y);
    vec3 lit=(uCSun.rgb*0.34+uCMoon.rgb*0.34)/PI+ambTop*0.30;
    outc=outc*(1.0-0.55*d)+lit*d*ct;
  }
  if(uMisc.y>0.0 && uBoltN>0){ vec3 b=boltGlow(ro,rd); outc+=b*uMisc.y*(0.4+0.6*ct); }
  if(uFog.y==1.0) outc=vec3(ct);
  if(uFog.y==9.0) outc=vec3((1.0-ct)*12.0);
  if(uFog.y==2.0) outc=vec3(cloudPresence(ro.xz+rd.xz*3000.0/max(rd.y,0.05)));
  o=vec4(min(outc,vec3(60000.0)),1.0e5);
}`;

// cosine-weighted average radiance around 6 axes -> ambient cube (6x1)
SH.ambFS = `
#include <common>
in vec2 vUV; out vec4 o; uniform samplerCube uEnv;
void main(){
  int i=int(gl_FragCoord.x);
  vec3 ax= i==0?vec3(1,0,0): i==1?vec3(-1,0,0): i==2?vec3(0,1,0): i==3?vec3(0,-1,0): i==4?vec3(0,0,1):vec3(0,0,-1);
  vec3 t=abs(ax.y)>0.5?vec3(1,0,0):vec3(0,1,0); vec3 b=normalize(cross(ax,t)); t=cross(b,ax);
  vec3 sum=vec3(0.0); float ws=0.0;
  for(int k=0;k<96;k++){
    float u=(float(k)+0.5)/96.0, phi=float(k)*2.39996323;
    float r=sqrt(u), z=sqrt(1.0-u);
    vec3 d=t*r*cos(phi)+b*r*sin(phi)+ax*z;
    vec3 c=textureLod(uEnv,d,3.0).rgb; sum+=min(c,vec3(200.0));
  }
  o=vec4(sum/96.0,1.0);
}`;

class Sky {
  constructor(g) {
    this.g = g; const gl = g.gl;
    this.p = {
      trans: g.fsProgram('trans', SH.transFS), skyView: g.fsProgram('skyView', SH.skyViewFS),
      noise3: g.fsProgram('noise3', SH.noise3FS), weather: g.fsProgram('weather', SH.weatherFS),
      sky: g.fsProgram('sky', SH.skyFS), amb: g.fsProgram('amb', SH.ambFS),
    };
    // static LUTs / noise
    this.trans = g.tex2D(256, 64, 'RGBA16F');
    this.transFbo = g.fbo([this.trans]);
    g.bind(this.transFbo); this.p.trans.use(); g.fs();
    this.skyViewTex = g.tex2D(1024, 256, 'RGBA16F', { wrap: 'repeat' });
    this.skyViewFbo = g.fbo([this.skyViewTex]);
    // repeat only horizontally: set T wrap to clamp
    gl.bindTexture(gl.TEXTURE_2D, this.skyViewTex.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.weather = g.tex2D(512, 512, 'RGBA16F', { wrap: 'repeat', mips: false });
    g.bind(g.fbo([this.weather])); this.p.weather.use(); g.fs();
    this.noise3 = g.tex3D(128, 128, 128, 'RGBA16F', { wrap: 'repeat' });
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.viewport(0, 0, 128, 128);
    this.p.noise3.use();
    for (let z = 0; z < 128; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.noise3.tex, 0, z);
      this.p.noise3.f('uSlice', z); g.fs();
    }
    gl.deleteFramebuffer(f);
    // env cubemap
    this.envSize = 256;
    this.env = g.cube(this.envSize, 'RGBA16F', true);
    this.envFbo = [];
    for (let i = 0; i < 6; i++) {
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.env.tex, 0);
      this.envFbo.push({ fb, w: this.envSize, h: this.envSize });
    }
    this.amb = g.tex2D(6, 1, 'RGBA16F', { filter: 'nearest' }); this.ambFbo = g.fbo([this.amb]);
    this.bolt = new Float32Array(64 * 4); this.boltN = 0; this.flashPos = [0, 1500, 0, 0];
    this.cloudQ = 1.0; this.envEvery = 1; this.frame = 0;
  }
  bindSkyUniforms(p) {
    p.t('uTrans', this.trans).t('uSkyView', this.skyViewTex).t('uWeather', this.weather).t('uNoise3', this.noise3)
      .f('uMieScale', this.mieScale || 1).v4('uFlashPos', this.flashPos).i('uBoltN', this.boltN);
    if (this.boltN) this.g.gl.uniform4fv(p.L('uBoltSeg'), this.bolt);
    return p;
  }
  update(S, L) {   // L: lighting from computeLighting
    const g = this.g, gl = g.gl;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    // sky-view LUT
    g.bind(this.skyViewFbo);
    this.mieScale = 1 + 4.0 * S.rain + 2.0 * S.storm + 1.5 * (S.haze || 0);
    this.p.skyView.use().t('uTrans', this.trans).f('uMieScale', this.mieScale).v3('uL0', L.sunDir).v3('uL1', L.moonDir)
      .v3('uE0', L.skyE0).v3('uE1', L.skyE1).f('uAlt', 0.002);
    g.fs();
  }
  renderEnv(camPos, half) {
    const g = this.g, gl = g.gl;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const p = this.p.sky.use(); this.bindSkyUniforms(p);
    p.f('uCloudQ', this.cloudQ).v3('uEnvOrigin', camPos[0], 0, camPos[2]);
    this.envPar = ((this.envPar || 0) + 1) & 1;
    for (let i = 0; i < 6; i++) { if (half && (i % 2) !== this.envPar) continue; g.bind(this.envFbo[i]); p.i('uFace', i); g.fs(); }
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.env.tex); gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    g.bind(this.ambFbo); this.p.amb.use().t('uEnv', this.env); g.fs();
  }
  drawSky(camPos) {
    const g = this.g, gl = g.gl;
    const p = this.p.sky.use(); this.bindSkyUniforms(p);
    p.f('uCloudQ', this.cloudQ).i('uFace', -1).v3('uEnvOrigin', camPos[0], 0, camPos[2]);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    g.fs();
  }
}

// ---------------------------------------------------------------- CPU lighting model
function illumSun(sinEl) {   // relative illuminance (noon clear = 1)
  const el = Math.asin(M.clamp(sinEl, -1, 1)) * 180 / Math.PI;
  if (el >= 0) return 4e-3 + Math.pow(Math.sin(el * Math.PI / 180), 1.2);
  return 4e-3 * Math.pow(10, el / 2.9);
}
function computeLighting(S, prevExpLog) {
  const lat = 0.62, decl = 0.16;
  const H = (S.hour - 12) / 24 * TAU_;
  const dirFrom = (H, decl) => [-Math.cos(decl) * Math.sin(H), Math.sin(decl) * Math.sin(lat) + Math.cos(decl) * Math.cos(lat) * Math.cos(H), -(Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(H))];   // z = south (right-handed, x = east)
  const sunDir = M.v3.norm(dirFrom(H, decl));
  const moonDir = M.v3.norm(dirFrom(H + Math.PI - 0.55, -decl * 0.6 + 0.05));
  const cosElong = M.v3.dot(sunDir, moonDir);
  const moonFrac = (1 - cosElong) / 2;
  const sinS = sunDir[1], sinM = moonDir[1];
  const E0 = 6.0;   // sun irradiance scale
  // exposure (partial adaptation)
  const cover = S.clouds;
  const cloudDim = 1 - 0.72 * cover * (0.6 + 0.4 * S.storm) - 0.15 * S.storm;
  const sunIll = illumSun(sinS) * M.mix(1, cloudDim, 0.45);
  const moonIll = 3.2e-6 * Math.pow(moonFrac, 2) * Math.max(0, Math.pow(Math.max(sinM, 0), 1.0)) * (1 - 0.6 * cover);
  const Etot = sunIll + moonIll + 2.5e-7 + 0.045 * Math.max(0, sunIll) ;
  const p = 0.62 + 0.18 * (1 - M.smooth(-5, -2.5, Math.log10(Etot)));
  const lowSun = M.smooth(-0.04, 0.02, sinS) * (1 - M.smooth(0.03, 0.4, sinS));
  const target = -p * Math.log(Etot) - 0.55 * lowSun;
  return { sunDir, moonDir, moonFrac, sinS, sinM, E0, target, sunIll, moonIll };
}
function lightColors(Lg, exposure, S) {
  const t0 = ATM.trans(0.0005, Lg.sunDir[1] + 0.004), t1 = ATM.trans(0.0005, Lg.moonDir[1] + 0.004).map(Math.sqrt);
  const tc0 = ATM.trans(1.8, Lg.sunDir[1]), tc1 = ATM.trans(1.8, Lg.moonDir[1]).map(Math.sqrt);
  const moonRel = 3.2e-6 * Math.pow(Lg.moonFrac, 2) * 6.0 * (Lg.sinM > -0.1 ? 1 : 0);
  const vis = (s) => M.smooth(-0.045, 0.0, s);     // horizon cut for direct lights
  const mt = [0.84, 0.92, 1.0];
  const sunE = t0.map(v => v * Lg.E0 * exposure * vis(Lg.sinS)), moonE = t1.map((v, i) => v * moonRel * mt[i] * exposure * vis(Lg.sinM));
  const csunE = tc0.map(v => v * Lg.E0 * exposure), cmoonE = tc1.map((v, i) => v * moonRel * mt[i] * exposure);
  return { sunE, moonE, csunE, cmoonE, skyE0: [Lg.E0 * exposure, Lg.E0 * exposure, Lg.E0 * exposure], skyE1: [moonRel * exposure * 0.95, moonRel * exposure * 0.97, moonRel * exposure] };
}
