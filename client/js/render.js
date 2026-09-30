/* 描画層: 元 flight-sim(9).html の Three.js シーン/地形/機体モデル/エフェクトをそのまま抽出。 */
const T=THREE,V3=T.Vector3,Q=T.Quaternion,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),$=id=>document.getElementById(id);
const ramp=(v,t,r,dt)=>v+clamp(t-v,-r*dt,r*dt);
const renderer=new T.WebGLRenderer({canvas:$('c'),antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new T.Scene(),FOG=0xbcd3e6;scene.fog=new T.Fog(FOG,1200,6800);
const cam=new T.PerspectiveCamera(60,1,.5,20000);
scene.add(new T.HemisphereLight(0xd6e8ff,0x5d6b48,.9));
const sun=new T.DirectionalLight(0xfff0d2,1.15);sun.position.set(-300,500,200);scene.add(sun);
// sky
const sc=document.createElement('canvas');sc.width=4;sc.height=256;const sx=sc.getContext('2d'),sg=sx.createLinearGradient(0,0,0,256);
[[0,'#2b64ad'],[.3,'#6fa8dc'],[.48,'#c9dfee'],[1,'#bcd3e6']].forEach(a=>sg.addColorStop(a[0],a[1]));sx.fillStyle=sg;sx.fillRect(0,0,4,256);
const sky=new T.Mesh(new T.SphereGeometry(15000,16,16),new T.MeshBasicMaterial({map:new T.CanvasTexture(sc),side:T.BackSide,fog:false,depthWrite:false}));scene.add(sky);
// terrain
const {WATER,EB,H,Hg}=World; // 地形関数はサーバーと共通(shared/world.js)
const N=180,SZ=14000,cell=SZ/N,tg=new T.PlaneGeometry(SZ,SZ,N,N);tg.rotateX(-Math.PI/2);
const pa=tg.attributes.position,bx=new Float32Array(pa.count),bz=new Float32Array(pa.count),colA=new T.BufferAttribute(new Float32Array(pa.count*3),3);
for(let i=0;i<pa.count;i++){bx[i]=pa.getX(i);bz[i]=pa.getZ(i)}
tg.setAttribute('color',colA);
const terr=new T.Mesh(tg,new T.MeshLambertMaterial({vertexColors:true,flatShading:true}));terr.frustumCulled=false;scene.add(terr);
let tx=1e9,tz=1e9;
function updTerr(){const nx=Math.round(S.pos.x/cell)*cell,nz=Math.round(S.pos.z/cell)*cell;if(nx===tx&&nz===tz)return;tx=nx;tz=nz;terr.position.set(nx,0,nz);
 for(let i=0;i<pa.count;i++){const x=bx[i]+nx,z=bz[i]+nz,h=H(x,z);pa.setY(i,h);
  const n=.9+.1*Math.sin(x*.05)*Math.cos(z*.07),f=(Math.floor(x/350)+Math.floor(z/350))&1?.9:1.05;let c;
  if(h<-1)c=[.72,.66,.45];else if(h<75)c=[.25*f,.43*f,.2*f];else if(h<150)c=[.42,.4,.36];else c=[.92,.94,.96];
  colA.setXYZ(i,c[0]*n,c[1]*n,c[2]*n)}
 pa.needsUpdate=true;colA.needsUpdate=true}
const water=new T.Mesh(new T.PlaneGeometry(24000,24000).rotateX(-Math.PI/2),new T.MeshPhongMaterial({color:0x2a6f9a,shininess:90,specular:0x9bbbd6}));water.position.y=WATER;scene.add(water);
// runway & buildings
const rc=document.createElement('canvas');rc.width=64;rc.height=512;const rx=rc.getContext('2d');rx.fillStyle='#3a3d42';rx.fillRect(0,0,64,512);rx.fillStyle='#ddd';rx.fillRect(3,0,2,512);rx.fillRect(59,0,2,512);rx.fillRect(30,0,4,280);
const rt=new T.CanvasTexture(rc);rt.wrapS=rt.wrapT=T.RepeatWrapping;rt.repeat.set(1,26);
const rw=new T.Mesh(new T.PlaneGeometry(45,1600).rotateX(-Math.PI/2),new T.MeshLambertMaterial({map:rt}));rw.position.set(0,.08,-550);scene.add(rw);
const box=(w,h,d,x,z,c)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshLambertMaterial({color:c}));m.position.set(x,h/2,z);(BG||scene).add(m)};let BG=new T.Group();scene.add(BG);
box(40,12,30,-110,120,0x9aa4ad);box(40,12,30,-110,60,0xb0b8bf);box(14,26,14,90,90,0xd8d2c4);box(30,8,20,-110,-20,0x8b949c);const myBG=BG;BG=new T.Group();scene.add(BG);
const erw=new T.Mesh(new T.PlaneGeometry(45,1600).rotateX(-Math.PI/2),new T.MeshLambertMaterial({map:rt}));erw.position.set(EB.x,.08,EB.z);scene.add(erw);
box(40,12,30,EB.x-110,EB.z+610,0xa8574e);box(40,12,30,EB.x-110,EB.z+550,0xb96a60);box(14,26,14,EB.x+90,EB.z+580,0xd9a79f);box(30,8,20,EB.x-110,EB.z+470,0x94524b);
const enBG=BG;BG=null;
const pole=(x,z,c)=>{const m=new T.Mesh(new T.CylinderGeometry(1.4,1.4,70,6),new T.MeshBasicMaterial({color:c}));m.position.set(x,35,z);scene.add(m)};pole(-60,110,0x4db8ff);pole(EB.x-60,EB.z+640,0xff4d3d);
const bBlue={g:myBG,p:new V3(-90,8,50),f:new V3(),spd:0,r:75,hp:600,max:600},bRed={g:enBG,p:new V3(EB.x-90,8,EB.z+545),f:new V3(),spd:0,r:75,hp:600,max:600};
for(const b of[bBlue,bRed])b.g.children.forEach(c=>c.userData.c=c.material.color.getHex());
// clouds
const clouds=[],cm=new T.MeshLambertMaterial({color:0xffffff,emissive:0x555f68,flatShading:true});
for(let i=0;i<70;i++){const g=new T.Group();for(let j=0;j<5;j++){const s=new T.Mesh(new T.SphereGeometry(70+Math.random()*90,7,5),cm);s.position.set((Math.random()-.5)*240,(Math.random()-.5)*30,(Math.random()-.5)*160);s.scale.y=.45;g.add(s)}
 g.position.set((Math.random()-.5)*10000,650+Math.random()*900,(Math.random()-.5)*10000);scene.add(g);clouds.push(g)}
// aircraft model
const plane=new T.Group(),mat=(c,r=.55)=>new T.MeshStandardMaterial({color:c,roughness:r,metalness:.15}),WH=mat(0xeef1f4),RD=mat(0xd6402f),DK=mat(0x22262b);
const add=(g,geo,m,x=0,y=0,z=0)=>{const o=new T.Mesh(geo,m);o.position.set(x,y,z);g.add(o);return o};
add(plane,new T.CylinderGeometry(.32,.6,5.6,14).rotateX(Math.PI/2),WH,0,0,.8);
add(plane,new T.CylinderGeometry(.6,.55,1.1,14).rotateX(Math.PI/2),RD,0,0,-2.55);
add(plane,new T.ConeGeometry(.17,.55,10).rotateX(-Math.PI/2),DK,0,0,-3.25);
add(plane,new T.SphereGeometry(.5,12,10).scale(1,.8,1.9),mat(0x1c2c3c,.15),0,.5,-.5);
add(plane,new T.BoxGeometry(11,.13,1.7),WH,0,-.1,-.2);
[-1.45,1.45].forEach(x=>add(plane,new T.CylinderGeometry(.05,.05,1.3,6).rotateX(Math.PI/2),DK,x,-.1,-1.25));
add(plane,new T.BoxGeometry(3.6,.1,.9),WH,0,.35,3.3);add(plane,new T.BoxGeometry(.1,1.3,1.1),RD,0,.95,3.1);
add(plane,new T.BoxGeometry(.06,.14,4.6),RD,0,.05,.6).scale.x=11;
const surf=(x,y,z,w,h,d,m,ox,oy,oz)=>{const p=new T.Group();p.position.set(x,y,z);add(p,new T.BoxGeometry(w,h,d),m,ox,oy,oz);plane.add(p);return p};
const ailL=surf(-3.9,-.1,.65,2.8,.07,.5,RD,0,0,.25),ailR=surf(3.9,-.1,.65,2.8,.07,.5,RD,0,0,.25);
const flpL=surf(-1.55,-.1,.65,1.6,.07,.45,WH,0,0,.22),flpR=surf(1.55,-.1,.65,1.6,.07,.45,WH,0,0,.22);
const elev=surf(0,.35,3.75,3.6,.08,.5,WH,0,0,.25),rud=surf(0,.3,3.65,.08,1.2,.5,WH,0,.6,.25);
add(plane,new T.SphereGeometry(.09,6,6),new T.MeshBasicMaterial({color:0xff2a2a}),-5.5,-.1,-.2);add(plane,new T.SphereGeometry(.09,6,6),new T.MeshBasicMaterial({color:0x2aff5a}),5.5,-.1,-.2);
const gear=new T.Group();gear.name='gear';gear.position.y=-.3;plane.add(gear);
[[0,-1.65],[-1.25,.35],[1.25,.35]].forEach(a=>{add(gear,new T.CylinderGeometry(.045,.045,.7,6),DK,a[0],-.35,a[1]);add(gear,new T.CylinderGeometry(.22,.22,.13,14).rotateZ(Math.PI/2),DK,a[0],-.68,a[1])});
const prop=new T.Group();prop.name='prop';prop.position.z=-3.55;plane.add(prop);
const blades=add(prop,new T.BoxGeometry(.14,2.3,.03),DK);const disc=add(prop,new T.CircleGeometry(1.15,24),new T.MeshBasicMaterial({color:0x222222,transparent:true,opacity:.1,side:T.DoubleSide,depthWrite:false}));
scene.add(plane);
const shadow=new T.Mesh(new T.CircleGeometry(5,20).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:0,transparent:true,opacity:.35,depthWrite:false}));scene.add(shadow);
const fx=[];let sfxK=1;
let nb;function sfx(f,d,v){if(!AC||muted)return;if(!nb){nb=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const a=nb.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1}
 const s=AC.createBufferSource();s.buffer=nb;const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=f*6;const g=AC.createGain();g.gain.setValueAtTime(Math.max(.0011,v*sfxK),AC.currentTime);g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+d);s.connect(lp);lp.connect(g);g.connect(AC.destination);s.start(0,Math.random()*.5,d)}
const fGeo=new T.SphereGeometry(1,8,6);
function puff(p,s,d,c,v){const m=new T.Mesh(fGeo,new T.MeshBasicMaterial({color:c,transparent:true,opacity:.9,depthWrite:false}));m.position.copy(p);m.scale.setScalar(s*.3);scene.add(m);fx.push({m,v,l:0,d,s})}
function boom(p,s){for(let i=0;i<7;i++)puff(p.clone().add(new V3((Math.random()-.5)*s,Math.random()*s*.6,(Math.random()-.5)*s)),s,i<4?.8:2.2,i<4?0xff9a2a:0x333333,new V3((Math.random()-.5)*s*.8,s*(.3+Math.random()*.8),(Math.random()-.5)*s*.8));sfx(70,.9,.5)}
function fxStep(dt){for(let i=fx.length-1;i>=0;i--){const f=fx[i];f.l+=dt;const k=f.l/f.d;f.m.position.addScaledVector(f.v,dt);f.m.scale.setScalar(f.s*(.3+k*1.1));f.m.material.opacity=.9*(1-k);if(k>=1){scene.remove(f.m);f.m.material.dispose();fx.splice(i,1)}}}
const tmat=c=>new T.MeshLambertMaterial({color:c,flatShading:true});
const eGeo=[new T.CylinderGeometry(.3,.5,5,8).rotateX(Math.PI/2),new T.BoxGeometry(9,.12,1.5),new T.BoxGeometry(3,.1,.8),new T.BoxGeometry(.1,1.1,1)],eM=[mat(0xb8322a),mat(0x3a3f46)];
const jpM=[mat(0x8f9c86),mat(0xa3a892)],jpRed=new T.MeshBasicMaterial({color:0xd8202a,side:T.DoubleSide}),jpBlk=mat(0x1b1b1b);
function mkJet(m,jp){const g=new T.Group();[[0,0,0],[1,-.1,-.2],[2,.3,2.2],[3,.8,2.1]].forEach(a=>{const o=new T.Mesh(eGeo[a[0]],a[0]==0||a[0]==3?m[0]:m[1]);o.position.set(0,a[1],a[2]);g.add(o)});
 if(jp){for(const x of[-2.7,2.7]){const d=new T.Mesh(new T.CircleGeometry(.75,16).rotateX(-Math.PI/2),jpRed);d.position.set(x,-.03,-.2);g.add(d)}
  const n=new T.Mesh(new T.CylinderGeometry(.52,.52,.7,10).rotateX(Math.PI/2),jpBlk);n.position.set(0,0,-2.5);g.add(n)}return g}const mMatE=new T.MeshBasicMaterial({color:0xff7a3a});
const aM=[mat(0x2f7fd6),mat(0xdfe6ee)];
const mk=$('mk'),mc=mk.getContext('2d');
// visuals
const eul=()=>{const f=new V3(0,0,-1).applyQuaternion(S.q),u=new V3(0,1,0).applyQuaternion(S.q),r=new V3(1,0,0).applyQuaternion(S.q);
 return{p:Math.asin(clamp(f.y,-1,1)),r:Math.atan2(-r.y,u.y),h:(Math.atan2(f.x,-f.z)*180/Math.PI+360)%360}};
function visuals(dt){
 updTerr();plane.position.copy(S.pos);plane.quaternion.copy(S.q);
 const el=S.el+S.trim;ailL.rotation.x=S.ai*.4;ailR.rotation.x=-S.ai*.4;elev.rotation.x=-el*.45;rud.rotation.y=S.ru*.4;flpL.rotation.x=flpR.rotation.x=S.flaps*.6;
 gear.visible=S.gearT>.02;gear.scale.set(1,Math.max(.01,S.gearT),1);
 if(!paused&&!S.crashed)prop.rotation.z+=(12+S.thr*60)*dt;blades.visible=S.thr<.45;disc.material.opacity=.06+.28*S.thr;
 const gy=Hg(S.pos.x,S.pos.z),agl=S.pos.y-gy;shadow.position.set(S.pos.x,gy+.15,S.pos.z);shadow.scale.setScalar(1+agl*.003);shadow.material.opacity=clamp(.4-agl*.0008,.05,.4);
 water.position.x=S.pos.x;water.position.z=S.pos.z;sky.position.copy(cam.position);
 for(const c of clouds){c.position.x+=clamp(Math.round((S.pos.x-c.position.x)/10000),-1,1)*10000;c.position.z+=clamp(Math.round((S.pos.z-c.position.z)/10000),-1,1)*10000}
 // chase camera
 cq.slerp(S.q,1-Math.exp(-dt*(camMode==2?30:4.5)));
 const lk=1-Math.exp(-dt*10);look.cy+=(look.y-look.cy)*lk;look.cp+=(look.p-look.cp)*lk;
 const lq=cq.clone().multiply(new Q().setFromAxisAngle(UP,look.cy)).multiply(new Q().setFromAxisAngle(X,look.cp));
 const off=[[0,3.4,13],[0,7,30],[0,.75,-.9]][camMode],p=new V3(...off).applyQuaternion(lq).add(S.pos);p.y=Math.max(p.y,Hg(p.x,p.z)+2.5);cam.position.copy(p);
 cam.up.copy(UP).lerp(new V3(0,1,0).applyQuaternion(lq),.5).normalize();
 cam.lookAt(new V3(0,camMode==2?.7:1.2,-30).applyQuaternion(lq).add(S.pos));
 const tf=(camMode==2?72:60)+S.V*.12;if(Math.abs(cam.fov-tf)>.05){cam.fov+=(tf-cam.fov)*.05;cam.updateProjectionMatrix()}
 if(AC&&!muted){const on=!S.crashed&&S.fuel>0;eng.frequency.value=34+S.thr*50;engG.gain.value=on?.05+.08*S.thr:0;windG.gain.value=Math.min(.12,S.V*.0015)}
}
const ac=$('adi').getContext('2d');
function adi(p,r){const c=ac;c.clearRect(0,0,160,160);c.save();c.beginPath();c.arc(80,80,74,0,7);c.clip();c.translate(80,80);c.rotate(-r);c.translate(0,p*170);
 c.fillStyle='#3b82c4';c.fillRect(-200,-400,400,400);c.fillStyle='#86592c';c.fillRect(-200,0,400,400);c.strokeStyle='#fff';c.lineWidth=2;c.beginPath();c.moveTo(-200,0);c.lineTo(200,0);c.stroke();
 c.lineWidth=1.5;c.font='10px monospace';c.fillStyle='#fff';c.textAlign='center';
 for(const d of[-20,-10,10,20]){const y=-d*Math.PI/180*170;c.beginPath();c.moveTo(-22,y);c.lineTo(22,y);c.stroke();c.fillText(Math.abs(d),36,y+3)}
 c.restore();c.strokeStyle='rgba(160,200,230,.55)';c.lineWidth=2;c.beginPath();c.arc(80,80,74,0,7);c.stroke();
 c.save();c.translate(80,80);c.rotate(-r);c.fillStyle='#ffb43b';c.beginPath();c.moveTo(0,-73);c.lineTo(-6,-61);c.lineTo(6,-61);c.fill();c.restore();
 c.strokeStyle='#ffb43b';c.lineWidth=3;c.beginPath();c.moveTo(34,80);c.lineTo(66,80);c.lineTo(80,91);c.lineTo(94,80);c.lineTo(126,80);c.stroke()}
const set=(id,v)=>{$(id).textContent=v};
function resize(){mk.width=innerWidth;mk.height=innerHeight;renderer.setSize(innerWidth,innerHeight,false);cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix()}
addEventListener('resize',resize);resize();
